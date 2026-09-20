"use client";

// V98_THIRD_PARTY_LAYOUT_AND_RATE_MATCH: 总览移除异常提醒；各国家量结构统计下移到底部；费率匹配严格跟随谷歌费率表。

// V94_RATE_MATCH_STRICT: 越南别名/币种后缀统一，同三方合并，费率列不再把代收/代付状态列误当费率。

// V90_DIRECT_RATE_AND_STATS: 代收/代付费率严格分开读取三方费率表；顶部补页面统计，底部保留结构统计图。

// V87_TNG_DUITNOW_QR_FIX: 马来 TNG/Touch n Go 归 DUITNOW/QR；Shopee/Grab/Boost 不再吃 TNG。

// V86_FORCE_PNPM_NETLIFY: 加 pnpm-lock.yaml，让 Netlify 依赖安装阶段使用 pnpm，不再 npm install。

// V85_FEE_TOTAL_MALAYSIA_TYPE_FIX: 只加合计手续费列；马来类型只显示 银行代付 / TNG代付，不显示 DUITNOW。

// V84_PNPM_BUILD_FIX: Netlify 改用 pnpm 构建，业务逻辑沿用 V83。

// V83_NETLIFY_CLEAN_INSTALL: 构建前删除 node_modules，修复 Netlify axe-core ENOTEMPTY。

// V82_LABEL_BUILD_FIX: 三方量仅改页签名字：月合计->合计，日合计->所有明细；恢复 package-lock 与 npm install 构建。

// V80_NETLIFY_BUILD_FIX: 仅修复 Netlify 构建命令；业务逻辑沿用 V79。

// V79_VERIFIED_BUILD: 所有明细第一、合计第二、移除平台明细、NPG/马来/印尼费率匹配修复。

import { useEffect, useMemo, useRef, useState } from "react";
import type { ThirdPartyPlatformStatusRow, ThirdPartyRatePayload, ThirdPartyRateRow, ThirdPartyVolumePayload, ThirdPartyVolumeRow, WorkOrderDepositRow } from "@/lib/types";
import { formatNumber, formatPercent, amountRatio, sumVolumeAmounts } from "@/lib/format";
import { canonicalThirdPartyName, confirmedIndiaThirdPartyAlias, inferThirdPartyChannelType } from "@/lib/thirdPartyNameMap";
import { canonicalThirdPartyPlatform, canonicalThirdPartyPlatformSelections, matchesThirdPartyPlatformSelection } from "@/lib/thirdPartyPlatform";
import { platformDisplayCountry, withPlatformDisplayCountry } from "@/lib/platformDisplayCountry";
import { dashboardBusinessFetch, isDashboardDataDenied, readDashboardDataCache, writeDashboardDataCache } from "@/lib/dashboardDataClient";
import { dashboardScopeAllows, dashboardScopeIdentity, effectiveDashboardDataScope } from "@/lib/dashboardDataScope";
import type { DashboardProfile } from "@/lib/dashboardAuthClient";
import { fetchPreferredMonthlyStatus, payloadSnapshotMonth, statusMatchesPayload, type ClientMonthlyStatus } from "@/lib/monthlyStatusClient";
import ThirdPartyRatesDashboard from "./ThirdPartyRatesDashboard";
import {useOrderTimeQuery, useOrderTimeComparison, TimeQueryExtra, OrderRecordModal} from "./OrderTimeControls";
import {timePlatformCountry,timePlatformName,timeVolumeData,timeSourceRows,timePlatformCoverage,type TimeQueryResult} from "@/lib/orderTimeVolume";
import {timeComparisonLabel,type TimeComparisonIssue} from "@/lib/orderTimeComparison";
import {sourceDay,sourceShortcutDateRange} from "@/lib/orderTimeQuery";
import { useDashboardAuth } from "./DashboardAuthGate";
import { buildCollectionSuccessView, collectionSuccessCountry, collectionSuccessProviderKey, type CollectionSuccessView } from "@/lib/collectionSuccess";
import { CollectionSuccessCell, CollectionSuccessBreakdown } from "./CollectionSuccessCell";
import { buildWithdrawPendingView, type WithdrawPendingView } from "@/lib/withdrawPending";
import { buildWorkOrderDepositView, workOrderDepositCountry, workOrderDepositProviderKey, workOrderSuccessTone, type WorkOrderDepositView } from "@/lib/workOrderDeposit";
import { buildWithdrawActualView, type WithdrawActualView } from "@/lib/withdrawActual";
import "./WithdrawPendingCell.css";

type LoadState = "loading" | "ready" | "error";
type VolumeSyncStatus = {
  ok?: boolean; start?: string; end?: string;
  historyTasks: number; historySuccess: number; historyRemaining: number; historyFailed: number;
  historyRowsWritten: number; historyLatestSyncAt?: string | null; historyComplete: boolean;
  dataDays: number; collectDays: number; payoutDays: number; latestWriteAt?: string | null; ratesLatestWriteAt?: string | null;
};
type VolumeTab = "daily" | "anomaly";
type FeeTab = "feeOverview" | "feeDetail" | "feeAnomaly";
type TabKey = VolumeTab | FeeTab;
type VolumeMainTab = "country" | "rates";
type CountrySubTab = "daily" | "platform" | "anomaly";
type PageSize = 20 | 50 | 100 | 200;
type PageStatTone = "default" | "collect" | "payout" | "fee" | "net";
type PageStatItem = [string, string | number] | {
  label: string;
  value: string | number;
  delta?: number;
  deltaPercent?: number | null;
  compareLabel?: string;
  helper?: string;
  tone?: PageStatTone;
  onClick?: () => void;
};

type ComboSummary = {
  key: string;
  labelParts: string[];
  collectAmount: number;
  collectCount: number;
  payoutAmount: number;
  payoutCount: number;
  totalAmount: number;
  totalCount: number;
  collectPct: number;
  payoutPct: number;
  totalPct: number;
  rows: ThirdPartyVolumeRow[];
};

type DirectionSummary = {
  key: string;
  parts: string[];
  amount: number;
  count: number;
  rows: ThirdPartyVolumeRow[];
};

type FeeCompareRow = {
  key: string;
  date?: string;
  country: string;
  platform: string;
  channel: string;
  channelType: string;
  collectAmount: number;
  collectCount: number;
  payoutAmount: number;
  payoutCount: number;
  totalAmount: number;
  totalCount: number;
  collectShare: number;
  payoutShare: number;
  totalShare: number;
  collectFeeRate: number;
  payoutFeeRate: number;
  totalFeeRate: number;
  effectiveTotalFeeRate: number;
  collectSingleFee: number;
  payoutSingleFee: number;
  collectFeeAmount: number;
  payoutFeeAmount: number;
  // 人工确认等明确业务通道：费率表没有对应费用时按 0 展示，而不是误显示“未匹配 -”。
  collectFeeKnownZero?: boolean;
  payoutFeeKnownZero?: boolean;
  collectAmountUnavailable?: boolean;
  payoutAmountUnavailable?: boolean;
  currency?: string | null;
  estimatedFee: number;
  advice: string;
  level: "normal" | "warning" | "danger" | "missing";
};

type DailyCompareRow = ComboSummary & {
  date: string;
  country: string;
  platform: string;
  channel: string;
  channelType: string;
  previousAmount: number;
  previousCount: number;
  previousCollectAmount: number;
  previousPayoutAmount: number;
  collectDiffPercent: number | null;
  payoutDiffPercent: number | null;
  diffAmount: number;
  diffPercent: number | null;
};

type PlatformCompareRow = ComboSummary & {
  date: string;
  country: string;
  platform: string;
};

type FeeAnomalyPeriod = "day" | "week" | "month";

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
}

function filterLabel(values: string[], placeholder = "全部"): string {
  if (!values.length) return placeholder;
  if (values.length <= 2) return values.join("、");
  return `${values.slice(0, 2).join("、")} 等 ${values.length} 项`;
}

/** Never reinterpret a daily total as a partial-hour or success-time result. */
function summaryQuerySource(input: {
  basis: "created" | "success"; start: string; end: string;
  platforms: string[]; availablePlatforms: string[]; detailPlatforms: string[];
}): "orders" | "daily" {
  const normalize = (value: string) => value.length === 16 ? `${value}:00` : value;
  const start = normalize(input.start), end = normalize(input.end);
  const validTime = (value: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}Z`)) && new Date(`${value}Z`).toISOString().slice(0,19) === value;
  if (!validTime(start) || !validTime(end) || end < start) throw new Error("请选择有效的开始和结束时间，结束时间不能早于开始时间。");
  if (Date.parse(`${end}Z`) - Date.parse(`${start}Z`) >= 31 * 86400000) throw new Error("单次最多查询 31 天，请缩短时间范围。");
  const selected = input.platforms.length ? input.platforms : input.availablePlatforms;
  if (!selected.length) throw new Error("当前范围暂无可查询平台。");
  const details = new Set(input.detailPlatforms);
  const legacy = selected.filter(name => !details.has(name));
  // An unselected platform filter means all available uploaded detail sources,
  // not that unrelated daily-only platforms should force everyone to legacy.
  if (!input.platforms.length && selected.some(name => details.has(name))) return "orders";
  if (input.detailPlatforms.length && !legacy.length) return "orders";
  const fullDays = start.endsWith("T00:00:00") && end.endsWith("T23:59:59");
  if (input.basis !== "created" || !fullDays) {
    // An automatic selection queries the supported intersection. A user's
    // explicit selection must never silently drop a requested platform.
    if (!input.platforms.length) {
      if (selected.some(name => details.has(name))) return "orders";
      throw new Error("当前国家暂无可按此时段查询的订单明细；已有日汇总请按创建时间的完整日期查询。");
    }
    const names = legacy.length ? legacy.join("、") : "所选平台";
    throw new Error(`${names} 尚未接入订单时间明细，仅能查询创建时间的完整日期（00:00:00—23:59:59）；不能按部分时段或成功时间查询。请选择已接入的平台，或查询完整日期。`);
  }
  return "daily";
}


const ALL_USDT_COUNTRY_PAGE = "所有国家USDT";
const COUNTRY_PRIORITY = ["印度", "巴西", "巴基斯坦", "印尼", "越南", "菲律宾", "马来", "缅甸", "哥伦比亚", "墨西哥", "智利", "尼日利亚", "胖虎巴西", "香港", "红膏蟹", "巴西原生", ALL_USDT_COUNTRY_PAGE, "南美", "USDT通道", "USDT"];

// 业务导航固定显示，不依赖查询结果。
// 进入页面即可先选择国家；真正的数据仍然只有点击「查询」后才读取 Supabase。
const COUNTRY_NAV_TABS = [
  "印度",
  "巴西",
  "巴基斯坦",
  "印尼",
  "越南",
  "菲律宾",
  "马来",
  "缅甸",
  "哥伦比亚",
  "墨西哥",
  "智利",
  "尼日利亚",
  "胖虎巴西",
  "香港",
  "红膏蟹",
  ALL_USDT_COUNTRY_PAGE,
];

function isHiddenCountry(country: string): boolean {
  return String(country || "").includes("埃及");
}

function isAllUsdtCountryPage(country: string): boolean {
  return String(country || "") === ALL_USDT_COUNTRY_PAGE;
}

function isUsdtVolumeRow(row: ThirdPartyVolumeRow): boolean {
  const text = `${row.country || ""} ${row.platform || ""} ${row.channel || ""} ${row.rawChannel || ""} ${row.channelType || ""} ${row.sheetName || ""}`.toLowerCase();
  const compact = text.replace(/[^a-z0-9]+/g, "");
  return /(^|[^a-z0-9])(usdt|trc20|erc20|tron|trx)([^a-z0-9]|$)/i.test(text)
    || /usdt|usdtu|usdtcu|trc20|erc20|tronpay|unipayusdt|upay13usdt|aypayusdt|uupayusdt/.test(compact);
}

function isUsdtFeeTarget(country: string, platform: string, channel: string, channelType?: string): boolean {
  const text = `${country || ""} ${platform || ""} ${channel || ""} ${channelType || ""}`.toLowerCase();
  const compact = text.replace(/[^a-z0-9]+/g, "");
  return /(^|[^a-z0-9])(usdt|trc20|erc20|tron|trx)([^a-z0-9]|$)/i.test(text)
    || /usdt|usdtu|usdtcu|trc20|erc20|tronpay|unipayusdt|upay13usdt|aypayusdt|uupayusdt/.test(compact);
}

function rowMatchesCountryPage(row: ThirdPartyVolumeRow, page: string): boolean {
  if (!page) return true;
  if (isAllUsdtCountryPage(page)) return isUsdtVolumeRow(row);
  return platformDisplayCountry(row.country, row.platform) === page;
}

function rowMatchesRequestedCountry(row: ThirdPartyVolumeRow, page: string): boolean {
  return !page || rowMatchesCountryPage(row, page);
}

function feeRowMatchesCountryPage(row: FeeCompareRow, page: string): boolean {
  if (!page) return true;
  if (isAllUsdtCountryPage(page)) {
    const text = `${row.country || ""} ${row.platform || ""} ${row.channel || ""} ${row.channelType || ""}`.toLowerCase();
    const compact = text.replace(/[^a-z0-9]+/g, "");
    return /(^|[^a-z0-9])(usdt|trc20|erc20|tron|trx)([^a-z0-9]|$)/i.test(text)
      || /usdt|usdtu|usdtcu|trc20|erc20|tronpay|unipayusdt|upay13usdt|aypayusdt|uupayusdt/.test(compact);
  }
  return row.country === page;
}

function countryRank(country: string): number {
  const normalized = country.replace(/原生|盘口|线下|地区/g, "").trim();
  const exact = COUNTRY_PRIORITY.findIndex((item) => normalized === item || country === item);
  if (exact >= 0) return exact;

  // 避免“胖虎巴西”因为包含“巴西”而被插到巴西盘口前面。
  if (country.includes("胖虎巴西")) {
    const idx = COUNTRY_PRIORITY.indexOf("胖虎巴西");
    return idx >= 0 ? idx : COUNTRY_PRIORITY.length + 1;
  }

  const includes = COUNTRY_PRIORITY
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item !== ALL_USDT_COUNTRY_PAGE && country.includes(item))
    .sort((a, b) => b.item.length - a.item.length || a.index - b.index)[0];
  return includes ? includes.index : COUNTRY_PRIORITY.length + 1;
}

function sortCountries(values: string[]): string[] {
  return uniq(values).sort((a, b) => countryRank(a) - countryRank(b) || a.localeCompare(b, "zh-CN", { numeric: true }));
}

function normalizeCountryLabel(value: string): string {
  const raw = String(value || "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return "";

  if (/巴基斯坦|pakistan|pkr/.test(lower)) return "巴基斯坦";
  if (/胖虎巴西/.test(raw)) return "巴西";
  if (/巴西|brazil|brasil|brl/.test(lower)) return "巴西";
  if (/印度|india|inr/.test(lower)) return "印度";
  if (/印度尼西亚|印尼|indonesia|idr/.test(lower)) return "印尼";
  if (/越南|vietnam|vnd/.test(lower)) return "越南";
  if (/菲律宾|philippines|philippine|php/.test(lower)) return "菲律宾";
  if (/马来西亚|马来|malaysia|myr/.test(lower)) return "马来";
  if (/缅甸|myanmar|mmk/.test(lower)) return "缅甸";
  if (/尼日利亚|nigeria|ngn/.test(lower)) return "尼日利亚";
  if (/哥伦比亚|colombia|columbia|npg[-_\s]*(co|col)\b|\bcop\b/.test(lower)) return "哥伦比亚";
  if (/墨西哥|mexico|npg[-_\s]*(me|mx|mex)\b|\bmxn\b/.test(lower)) return "墨西哥";
  if (/智利|chile|npg[-_\s]*(cl|chl|chi)\b|\bclp\b/.test(lower)) return "智利";
  if (/南美|south\s*america/.test(lower)) return "南美";
  if (/usdt|trc20|trx|u通道/.test(lower)) return "USDT";

  return raw
    .replace(/胖虎/g, "")
    .replace(/线下盘口|线上盘口|原生盘口|盘口|原生|线下|国家|地区/g, "")
    .trim();
}

const SOUTH_AMERICA_RATE_COUNTRIES = ["墨西哥", "哥伦比亚", "智利"] as const;

function isStrictSouthAmericaRateCountry(value: string): boolean {
  return SOUTH_AMERICA_RATE_COUNTRIES.includes(normalizeCountryLabel(value) as (typeof SOUTH_AMERICA_RATE_COUNTRIES)[number]);
}

function expandRateCountries(value: string): string[] {
  const normalized = normalizeCountryLabel(value);
  if (!normalized) return [];

  // V7N：南美三国的费率必须严格按国家隔离。
  // 墨西哥 / 哥伦比亚 / 智利不能再共同写入或读取“南美”兜底，
  // 否则 TodayPay / STARPAGO 等同名三方会把 CLP 单笔 800/2200 串到 MXN 页面。
  if (normalized === "南美" || isStrictSouthAmericaRateCountry(normalized)) return [normalized];

  return [normalized];
}

function normalizeFeeTypeToken(country: string, value?: string): string {
  const raw = normalizeRateCategory(country, value) || String(value || "").trim();
  return raw.replace(/\s+/g, " ").trim();
}

function feeTypeCandidates(country: string, value?: string): string[] {
  const normalizedCountry = normalizeCountryLabel(country);
  const base = normalizeFeeTypeToken(country, value);
  const set = new Set<string>();
  const add = (x?: string) => {
    const token = normalizeFeeTypeToken(country, x);
    if (token) set.add(token);
  };
  add(base);
  add(value);

  const keys = Array.from(set).map((x) => normalizeMatchKey(x)).join("|");

  if (normalizedCountry.includes("越南")) {
    const baseKey = normalizeMatchKey(base);
    const hasMomo = /momo/.test(keys) || baseKey === "momo";
    if (hasMomo) { add("MOMO"); add("MoMo"); add("MoMo钱包"); add("钱包"); }
    if (/1vnpay/.test(keys)) {
      add("1VNPay"); add("1VNPay-MoMo"); add("1VNPay MoMo");
      if (hasMomo) { add("MOMO"); add("MoMo"); }
      else { add("银行"); add("BANK"); add("THẺ CÀO"); }
    }
    if (/fastpay|fastmomo|fastpaymomo/.test(keys)) {
      add("FASTPay"); add("FastPay"); add("FASTPAY");
      if (hasMomo) { add("MOMO"); add("MoMo"); }
    }
  }

  if (normalizedCountry.includes("马来")) {
    if (["银行", "银行代付", "代付类型"].includes(base)) {
      add("银行");
      add("银行代付");
      add("代付类型");
      add("FPX-BANK");
      add("Bank");
      add("BANK");
      add("Tng-DuitNow-TP");
      add("TNG-DuitNow-TP");
      add("TNG DUITNOW TP");
      add("FPXDUITNOW-TP");
      add("DuitNow-TP");
      add("其他类型");
    }
    if (base === "DUITNOW/QR") {
      add("DUITNOW/QR");
      add("Touch n Go");
      add("TNG");
      add("TouchGo");
      add("Touch 'n Go");
      add("Touch n Go-TP");
      add("Touch n Go - TP");
      add("DuitNow");
      add("DuitNow QR");
      add("FPXDUITNOW");
      add("FPXDUITNOW-TP");
    }
    if (base === "FPX-BANK") {
      add("银行");
      add("银行代付");
      add("Bank");
    }
  }

  if (normalizedCountry.includes("印尼")) {
    const baseKey = normalizeMatchKey(base);
    if (["银行代付", "Virtual Account", "代付类型"].includes(base) || ["virtualaccount", "va", "bank", "bni", "bri", "brin", "bnin", "bmri", "cena", "mandiri", "permata", "bca", "cimb"].includes(baseKey)) {
      // 银行类型候选放银行代付最前，优先匹配银行单笔费；不要误吃钱包单笔费。
      add("银行代付");
      add("Virtual Account");
      add("VA");
      add("BANK");
      add("Bank");
      add("银行");
      add("其他类型");
    }
    if (["钱包代付", "代付类型"].includes(base) || ["dana", "ovo", "gopay", "gojek", "linkaja", "linkajaewallet", "ewallet", "wallet", "钱包", "其他钱包"].includes(baseKey)) {
      // DANA / OVO / GOPAY / LINKAJA 都按钱包代付同类比较；费率优先匹配钱包代付。
      add("钱包代付");
      add("钱包");
      add("其他钱包");
      add("E-Wallet");
      add("Wallet");
      add("DANA");
      add("OVO");
      add("GOPAY");
      add("GoPay");
      add("LINKAJA");
      add("LinkAja");
      add("LinkAja钱包");
    }
    if (base === "Virtual Account") add("银行代付");
  }
  if (/usdt|trx|trc20|tron/i.test(keys) || normalizedCountry.includes("USDT")) {
    // USDT 通道不能把所有 USDT 三方互相加入候选，否则 UNIPAY 会误匹配到 TRONPAY 的 4TRX。
    // 按名称精确扩展：UNIPAY=2.9/3.5TRX，TRONPAY=3/4TRX，UPay13/AYPay/UUPay 各走自己的行。
    if (/unipay|uni[-_ ]?pay/.test(keys)) ["UniPayUSDT", "UNIPAY-USDT", "UNIPAY", "UniPay", "UniPayUSDTCU"].forEach(add);
    if (/tronpay|tron[-_ ]?pay/.test(keys)) ["TronPayUSDT", "TRONPAY-USDT", "TRONPAY", "TronPay", "TronPayUSDTCU"].forEach(add);
    if (/uupay|uu[-_ ]?pay/.test(keys)) ["UUPayUSDT", "UUPAY-USDT", "UUPAY", "UUPay", "UUPayUSDTCU"].forEach(add);
    if (/upay13|upay[-_ ]?13/.test(keys)) ["UPay13USDT", "UPay13USDTCU", "UPay13", "UPAY13"].forEach(add);
    if (/aypay|ay[-_ ]?pay/.test(keys)) ["AYPayUSDT", "AYPayUSDTCU", "AYPAY", "AYPay"].forEach(add);
    if (/\bupay\b|^upay$/.test(keys)) ["UPayUSDT", "UPAY", "UPay"].forEach(add);
    if (/^usdt$|trc20/.test(keys)) ["USDT", "TRC20"].forEach(add);
  }


  if (normalizedCountry.includes("印度")) {
    // 印度类型按用户确认只分：UPI / 银行卡 / USDT。未明确时默认走 UPI，避免显示“印度线下/其他类型”。
    if (/usdt|trx|trc20|tron/.test(keys)) { add("USDT"); add("USDT通道"); }
    if (/bank|银行卡|银行|card|arbpay|arbbank/.test(keys)) { add("银行卡"); add("BANK"); add("Bank"); }
    if (!base || /upi|paytm|phonepe|qr|扫码|其他类型|印度线下/.test(keys) || base === "UPI") { add("UPI"); add("QR"); add("扫码"); }
    if (/wepay/.test(keys)) ["WePay", "WEPAY唤醒", "PAYTM-WePay", "QR-WePay", "WePay-QR"].forEach(add);
    if (/movpay/.test(keys)) ["MovPay", "MovPay-QR"].forEach(add);
    if (/magicpay/.test(keys)) ["MagicPay", "MagicPay-QR"].forEach(add);
    if (/upipay/.test(keys)) ["UpiPay", "UpiPay-QR"].forEach(add);
    if (/ninepay|ninepayinr191|ninepayinr213/.test(keys)) ["NinePay", "NinePay-QR", "NinePayINR 191", "NinePayINR 213", "PAYTM-NinePay"].forEach(add);
  }

  if (["墨西哥", "哥伦比亚"].some((item) => normalizedCountry.includes(item))) {
    if (/beacon|okeypay|okpay|okaypay/.test(keys)) ["BeaconPay", "Beaconpay", "OKEYPAY", "OkeyPay", "OKPAY", "OkPay", "OKAYPAY", "OkayPay"].forEach(add);
  }
  if (["墨西哥", "哥伦比亚", "智利"].some((item) => normalizedCountry.includes(item))) {
    if (/tod|todaypay|todpay/.test(keys)) ["TodayPay", "TOD", "TODPAY", "TODPay", "todpay", "TODPAY-NEW"].forEach(add);
    if (/starpago/.test(keys)) ["STARPAGO", "StarPago", "starpago"].forEach(add);
    if (/epay/.test(keys)) ["EPay", "EPAY", "Epay", "epay"].forEach(add);
    if (/supefina/.test(keys)) ["Supefina", "SUPEFINA", "supefina", "SUPEFINAPAY", "SUPEFINA-transfiya"].forEach(add);
  }

  if (normalizedCountry.includes("巴基斯坦")) {
    if (["代付", "代付类型", "其他钱包", "钱包", "银行代付"].includes(base)) {
      add("代付");
      add("代付类型");
      add("EASYPAISA");
      add("EasyPaisa");
      add("EasyPisa");
      add("JazzCash");
      add("JAZZCASH");
      add("其他钱包");
      add("Wallet");
      add("Bank");
    }
  }


  if (normalizedCountry.includes("菲律宾")) {
    const baseKey = normalizeMatchKey(base);
    if (["代付", "代付类型", "其他钱包", "其他类型"].includes(base)) {
      add("代付");
      add("代付类型");
      add("其他钱包");
      add("其他类型");
      add("GCASH");
      add("PAYMAYA");
      add("GOTYME");
      add("GRABPAY");
      add("银行代付");
      add("BANK");
    }
    if (["gcash"].includes(baseKey)) { add("GCASH"); add("GCash"); add("Gcash"); }
    if (["paymaya", "maya"].includes(baseKey)) { add("PAYMAYA"); add("PayMaya"); add("Maya"); }
    if (["gotyme", "gotymepay"].includes(baseKey)) { add("GOTYME"); add("GoTyme"); add("GOtyMe"); }
    if (["grabpay", "grab"].includes(baseKey)) { add("GRABPAY"); add("GrabPay"); }
    if (["银行代付", "bank", "bankpayout", "bankcard"].includes(baseKey)) { add("银行代付"); add("代付"); add("BANK"); add("Bank"); }
  }

  if (["墨西哥", "哥伦比亚", "智利", "南美"].some((item) => normalizedCountry.includes(item))) {
    const baseKey = normalizeMatchKey(base);
    add(base);
    if (!base || ["其他类型", "代付类型", "其他钱包"].includes(base)) {
      ["SPEI", "PSE", "Nequi", "BRE-B", "BRE_B", "BRE-KEY", "BRE_KEY", "Transfiya", "Cash", "OXXO", "OXXO Pay", "CoDi", "CLABE", "Bank", "Bank Card", "Card(Webpay)", "Card", "Bank(Khipu)", "E-Wallet(Mach)", "E-Wallet", "Cash(Pago46)"].forEach(add);
    }
    if (["breb", "breb"].includes(baseKey)) { add("BRE-B"); add("BRE_B"); }
    if (["brekey"].includes(baseKey)) { add("BRE-KEY"); add("BRE_KEY"); }
    if (["bank", "bankcard", "banktarjeta", "card"].includes(baseKey)) { add("Bank"); add("Bank Card"); add("Card"); }
    if (["oxxo", "oxxopay"].includes(baseKey)) { add("OXXO"); add("OXXO Pay"); }
    if (["cardwebpay", "webpay"].includes(baseKey)) { add("Card(Webpay)"); add("Card"); }
    if (["bankkhipu", "khipu"].includes(baseKey)) { add("Bank(Khipu)"); add("Bank"); }
    if (["ewalletmach", "ewallet", "mach"].includes(baseKey)) { add("E-Wallet(Mach)"); add("E-Wallet"); }
    if (["cashpago46", "pago46"].includes(baseKey)) { add("Cash(Pago46)"); add("Cash"); }
  }


  if (normalizedCountry.includes("印度")) {
    const baseKey = normalizeMatchKey(base);
    if (/ninepayinr191|ninepayqr/.test(baseKey)) { add("NinePayINR 191"); add("NinePayINR191"); add("NinePay-QR"); }
    if (/ninepayinr213|paytmninepay/.test(baseKey)) { add("NinePayINR 213"); add("NinePayINR213"); add("PAYTM-NinePay"); }
    if (/wepay/.test(keys)) { add("WePay"); add("WEPAY唤醒"); add("PAYTM-WePay"); add("QR-WePay"); }
    if (/movpay/.test(keys)) { add("MovPay"); add("MovPay-QR"); }
    if (/magicpay/.test(keys)) { add("MagicPay"); add("MagicPay-QR"); }
    if (/upipay/.test(keys)) { add("UpiPay"); add("UpiPay-QR"); }
  }

  add("");
  return Array.from(set);
}

function feeTypeMatches(country: string, expectedType: string, actualType: string): boolean {
  const expected = new Set(feeTypeCandidates(country, expectedType));
  const actual = normalizeFeeTypeToken(country, actualType);
  return !expected.size || !actual || expected.has(actual);
}

function sumRows(rows: ThirdPartyVolumeRow[]) {
  const collectRows = rows.filter((row) => row.direction === "代收");
  const payoutRows = rows.filter((row) => row.direction === "代付");
  const collectAmount = sumVolumeAmounts(collectRows);
  const collectCount = collectRows.reduce((sum, row) => sum + row.count, 0);
  const payoutAmount = sumVolumeAmounts(payoutRows);
  const payoutCount = payoutRows.reduce((sum, row) => sum + row.count, 0);
  return {
    amount: sumVolumeAmounts(rows),
    count: collectCount + payoutCount,
    collectAmount,
    collectCount,
    payoutAmount,
    payoutCount
  };
}

function aggregateCombo(rows: ThirdPartyVolumeRow[], keyFn: (row: ThirdPartyVolumeRow) => string[]): ComboSummary[] {
  const map = new Map<string, { parts: string[]; rows: ThirdPartyVolumeRow[] }>();
  for (const row of rows) {
    const parts = keyFn(row);
    const key = parts.join("|||");
    const current = map.get(key) || { parts, rows: [] };
    current.rows.push(row);
    map.set(key, current);
  }

  const totalCollectAmount = sumVolumeAmounts(rows.filter((row) => row.direction === "代收"));
  const totalPayoutAmount = sumVolumeAmounts(rows.filter((row) => row.direction === "代付"));
  const totalAmount = sumVolumeAmounts(rows);

  return Array.from(map.entries()).map(([key, item]) => {
    const collectRows = item.rows.filter((row) => row.direction === "代收");
    const payoutRows = item.rows.filter((row) => row.direction === "代付");
    const collectAmount = sumVolumeAmounts(collectRows);
    const collectCount = collectRows.reduce((sum, row) => sum + row.count, 0);
    const payoutAmount = sumVolumeAmounts(payoutRows);
    const payoutCount = payoutRows.reduce((sum, row) => sum + row.count, 0);
    const rowTotalAmount = sumVolumeAmounts(item.rows);
    const rowTotalCount = collectCount + payoutCount;
    return {
      key,
      labelParts: item.parts,
      collectAmount,
      collectCount,
      payoutAmount,
      payoutCount,
      totalAmount: rowTotalAmount,
      totalCount: rowTotalCount,
      collectPct: amountRatio(collectAmount,totalCollectAmount),
      payoutPct: amountRatio(payoutAmount,totalPayoutAmount),
      totalPct: amountRatio(rowTotalAmount,totalAmount),
      rows: item.rows
    };
  }).sort((a, b) => b.totalAmount - a.totalAmount || b.totalCount - a.totalCount);
}

function aggregateDirection(rows: ThirdPartyVolumeRow[], keyFn: (row: ThirdPartyVolumeRow) => string[]): DirectionSummary[] {
  const map = new Map<string, DirectionSummary>();
  for (const row of rows) {
    const parts = keyFn(row);
    const key = parts.join("|||");
    const current = map.get(key) || { key, parts, amount: 0, count: 0, rows: [] };
    current.amount += row.amount;
    current.count += row.count;
    current.rows.push(row);
    map.set(key, current);
  }
  return Array.from(map.values()).sort((a, b) => b.amount - a.amount || b.count - a.count);
}

function formatLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function yesterdayLocalDateKey(): string {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return formatLocalDateKey(date);
}

type DateShortcut = "today" | "yesterday" | "beforeYesterday" | "thisWeek" | "lastWeek" | "thisMonth" | "lastMonth";

function shortcutDateRange(mode: DateShortcut, selectedDateKey = ""): { start: string; end: string } {
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
    const selectedDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDateKey)
      ? new Date(`${selectedDateKey}T12:00:00`)
      : new Date(now);
    const base = mode === "lastMonth" && !Number.isNaN(selectedDate.getTime()) ? selectedDate : now;
    start.setFullYear(base.getFullYear(), base.getMonth(), 1);
    if (mode === "lastMonth") start.setMonth(start.getMonth() - 1);
    end.setFullYear(start.getFullYear(), start.getMonth() + 1, 0);
  }

  return { start: formatLocalDateKey(start), end: formatLocalDateKey(end) };
}

function monthDateRange(dateKey: string): { start: string; end: string } {
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})/);
  const fallback = formatLocalDateKey(new Date());
  const [year, month] = match ? [Number(match[1]), Number(match[2])] : [Number(fallback.slice(0, 4)), Number(fallback.slice(5, 7))];
  const endDay = new Date(year, month, 0).getDate();
  const ym = `${year}-${String(month).padStart(2, "0")}`;
  return { start: `${ym}-01`, end: `${ym}-${String(endDay).padStart(2, "0")}` };
}

function preferredDefaultDate(rows: ThirdPartyVolumeRow[]): string {
  const dates = uniq(rows.map((row) => row.date));
  if (!dates.length) return "";
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = formatLocalDateKey(yesterday);
  return dates.includes(yesterdayKey) ? yesterdayKey : dates[dates.length - 1];
}

function defaultStart(rows: ThirdPartyVolumeRow[]): string {
  return preferredDefaultDate(rows);
}

function defaultEnd(rows: ThirdPartyVolumeRow[]): string {
  return preferredDefaultDate(rows);
}

function dateMatches(date: string, start: string, end: string): boolean {
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function dateAdd(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function currentMonthPrefix(): string {
  return formatLocalDateKey(new Date()).slice(0, 7);
}

function rangeIncludesCurrentMonth(start = "", end = ""): boolean {
  const now = new Date();
  const current = currentMonthPrefix();
  const previousDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previous = `${previousDate.getFullYear()}-${String(previousDate.getMonth() + 1).padStart(2, "0")}`;
  const activeMonths = new Set([current]);
  if (now.getDate() <= 7) activeMonths.add(previous);
  const safeStart = (start || `${current}-01`).slice(0, 7);
  const safeEnd = (end || `${current}-31`).slice(0, 7);
  return Array.from(activeMonths).some((month) => safeStart <= month && safeEnd >= month);
}

function thirdPartyVolumeApiUrl(start = "", end = "", version = "", country = ""): string {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (country) params.set("country", country);
  if (version) params.set("v", version);
  const query = params.toString();
  return query ? `/api/supabase-third-party-volume?${query}` : "/api/supabase-third-party-volume";
}

function thirdPartySyncStatusApiUrl(start = "", end = ""): string {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return `/api/supabase-third-party-sync-status?${params.toString()}`;
}

function weekKey(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function periodKeyFor(date: string, period: FeeAnomalyPeriod): string {
  if (period === "month") return date.slice(0, 7);
  if (period === "week") return weekKey(date);
  return date;
}

function buildDailyCompareRows(rows: ThirdPartyVolumeRow[], lookupRows: ThirdPartyVolumeRow[] = rows): DailyCompareRow[] {
  // 所有明细改成按「日期 + 国家 + 统一三方」汇总，下面展开再看各类型总量（跨平台合并）。
  const grouped = aggregateCombo(rows, (row) => [row.date, row.country, row.channel]);
  const lookupGrouped = aggregateCombo(lookupRows, (row) => [row.date, row.country, row.channel]);
  const byKey = new Map<string, ComboSummary>();
  for (const row of lookupGrouped) {
    const [date = "", country = "", channel = ""] = row.labelParts;
    byKey.set(`${date}|||${country}|||${channel}`, row);
  }
  return grouped.map((row) => {
    const [date = "", country = "", channel = ""] = row.labelParts;
    const prevDate = dateAdd(date, -1);
    const prev = byKey.get(`${prevDate}|||${country}|||${channel}`);
    const previousAmount = prev?.totalAmount || 0;
    const previousCount = prev?.totalCount || 0;
    const previousCollectAmount = prev?.collectAmount || 0;
    const previousPayoutAmount = prev?.payoutAmount || 0;
    const diffAmount = row.totalAmount - previousAmount;
    const diffPercent = previousAmount ? diffAmount / previousAmount : null;
    const collectDiffPercent = previousCollectAmount ? (row.collectAmount - previousCollectAmount) / previousCollectAmount : null;
    const payoutDiffPercent = previousPayoutAmount ? (row.payoutAmount - previousPayoutAmount) / previousPayoutAmount : null;
    return { ...row, date, country, platform: "", channel, channelType: "", previousAmount, previousCount, previousCollectAmount, previousPayoutAmount, collectDiffPercent, payoutDiffPercent, diffAmount, diffPercent };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.totalAmount - a.totalAmount || b.totalCount - a.totalCount);
}

function buildPlatformCompareRows(rows: ThirdPartyVolumeRow[]): PlatformCompareRow[] {
  const grouped = aggregateCombo(rows, (row) => [row.date, row.country, row.platform]);
  return grouped.map((row) => {
    const [date = "", country = "", platform = ""] = row.labelParts;
    return { ...row, date, country, platform };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.totalAmount - a.totalAmount || b.totalCount - a.totalCount || a.platform.localeCompare(b.platform, "zh-CN", { numeric: true }));
}

function cleanRateTextForParse(value: string): string {
  return String(value || "")
    .trim()
    .replace(/，/g, " ")
    .replace(/；/g, " ")
    .replace(/;/g, " ")
    .replace(/　/g, " ")
    .replace(/(\d),(\d)(?=\s*%|\s*$)/g, "$1.$2")
    .replace(/,/g, "");
}

type TierFee = { threshold: number; op: "above" | "below"; rate: number; single: number };

function extractTierFees(value: string): TierFee[] {
  const raw = cleanRateTextForParse(value);
  if (!raw || !raw.includes("%")) return [];
  const compactText = raw.replace(/\s+/g, " ");
  const tiers: TierFee[] = [];
  const pushTier = (thresholdRaw: string, word: string, rateRaw: string, singleRaw?: string) => {
    const threshold = Number(thresholdRaw);
    const ratePercent = Number(rateRaw);
    const single = singleRaw ? Number(singleRaw) : 0;
    if (!Number.isFinite(threshold) || !Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 50) return;
    const tier: TierFee = {
      threshold,
      op: /以上|above|>=/i.test(word || "") ? "above" : "below",
      rate: ratePercent / 100,
      single: Number.isFinite(single) ? single : 0
    };
    const key = `${tier.threshold}|||${tier.op}|||${tier.rate}|||${tier.single}`;
    if (!tiers.some((item) => `${item.threshold}|||${item.op}|||${item.rate}|||${item.single}` === key)) tiers.push(tier);
  };

  const thresholdFirst = /(\d+(?:\.\d+)?)\s*(以上|以下|以内|以內|below|above|>=|<=)\s*[^\d%]{0,20}?(\d+(?:\.\d+)?)\s*%\s*(?:[+＋]\s*(?:单笔|每笔|笔费)?\s*(\d+(?:\.\d+)?))?/gi;
  let match: RegExpExecArray | null;
  while ((match = thresholdFirst.exec(compactText)) !== null) pushTier(match[1], match[2] || "", match[3], match[4]);

  const rateFirst = /(\d+(?:\.\d+)?)\s*%\s*(?:[+＋]\s*(?:单笔|每笔|笔费)?\s*(\d+(?:\.\d+)?))?\s*[^\d%]{0,30}?(\d+(?:\.\d+)?)\s*(以上|以下|以内|以內|below|above|>=|<=)/gi;
  while ((match = rateFirst.exec(compactText)) !== null) pushTier(match[3], match[4] || "", match[1], match[2]);
  return tiers;
}

function pickTierFee(value: string, avgAmount = 0): TierFee | null {
  const tiers = extractTierFees(value);
  if (!tiers.length) return null;
  if (avgAmount > 0) {
    const matched = tiers.find((tier) => tier.op === "above" ? avgAmount >= tier.threshold : avgAmount <= tier.threshold);
    if (matched) return matched;
  }
  // 没有平均金额时，只取第一个真实百分比，不把“2001以上/3000以下”这些门槛当成 2001%。
  return tiers[0];
}

function parseFeeRate(value: string): number {
  const raw = cleanRateTextForParse(value);
  if (!raw || raw === "-" || raw === "—" || /没有|无|关闭|暂停/.test(raw)) return 0;
  // USDT/TRX 通道表里的 2.9TRX / 3.5TRX / 4TRX 是单笔 TRX 手续费，不是百分比。
  // 这里必须返回 0，让 singleFeeFor() 去当“单笔费用”计算，不能误算成 2.9% / 4%。
  if (/\btrx\b|trx|trc20|usdt/i.test(raw) && !raw.includes("%")) return 0;
  if (raw.includes("%")) {
    const percent = raw.match(/(-?\d+(?:\.\d+)?)\s*%/);
    if (!percent) return 0;
    const n = Number(percent[1]);
    if (!Number.isFinite(n) || n < 0 || n > 50) return 0;
    return n / 100;
  }
  if (/以上|以下|以内|以內|above|below|>=|<=/i.test(raw)) return 0;
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = Number(match[0]);
  if (!Number.isFinite(n) || n < 0) return 0;
  // Google 表有些单元格会把 0.70% 读成 0.7，有些会把 1.9% 读成 0.019。
  // 规则：0.05 以下按小数率处理；0.05~50 按百分数字处理，避免 0.9 被算成 90%。
  if (n > 50) return 0;
  if (n >= 0.05) return n / 100;
  return n;
}

function parseConditionalRate(value: string, avgAmount = 0): number {
  const raw = cleanRateTextForParse(value);
  if (!raw || raw === "-" || raw === "—" || raw.includes("没有") || raw.includes("无")) return 0;
  if (/\btrx\b|trx|trc20|usdt/i.test(raw) && !raw.includes("%")) return 0;
  if (raw.includes("+") && !raw.includes("%")) return 0;
  const tier = pickTierFee(raw, avgAmount);
  if (tier) return tier.rate;
  return parseFeeRate(raw);
}

type RateLike = Pick<ThirdPartyRateRow, "country" | "category" | "thirdParty" | "collectFee" | "payoutFee" | "totalFee" | "collectSingleFee" | "payoutSingleFee" | "collectLimit" | "payoutLimit"> & { platform?: string; channelInfo?: string; sheetName?: string; scopePlatformOnly?: boolean };

function shouldUseTotalFeeAsRate(value: string): boolean {
  const raw = String(value || "").trim();
  if (!raw || raw === "-" || raw === "—" || raw.includes("没有") || raw.includes("无")) return false;
  // 例如巴西 TDPayBRL 的“0.1+0.1”是单笔费用，不是 10% 费率。
  if (raw.includes("+") && !raw.includes("%")) return false;
  return raw.includes("%");
}

function rateFor(row: RateLike | undefined, kind: "collect" | "payout" | "total", avgAmount = 0): number {
  if (!row) return 0;
  const conditional = (value: string) => parseConditionalRate(value, avgAmount);
  if (kind === "collect") {
    // 代收、代付必须分开读；不能用合计费率/代收费率去顶代付，否则会出现代付无费率却显示代收费率的问题。
    return conditional(row.collectFee);
  }
  if (kind === "payout") {
    return conditional(row.payoutFee);
  }
  return shouldUseTotalFeeAsRate(row.totalFee) ? conditional(row.totalFee) : conditional(row.collectFee) + conditional(row.payoutFee);
}

function parseSingleFee(value: string): number {
  const raw = cleanRateTextForParse(value);
  if (!raw || raw === "-" || raw === "—" || raw.includes("无") || raw.includes("没有")) return 0;
  if (/以上|以下|以内|以內|above|below|>=|<=/i.test(raw) && !/[+＋]\s*(?:单笔|每笔|笔费)?\s*\d/i.test(raw)) return 0;
  // 如果同一个格子写成“0.9% + 单笔1 / 3%+6”，单笔要取 + 后面或“单笔”后面的数字，不能把 0.9 当成单笔。
  if (raw.includes("%")) {
    // 先找明确标注的“单笔/每笔/笔费”，避免把另一段百分比（例如 +4.50%）误当成单笔 4.5。
    const explicitSingle = raw.match(/(?:单笔|每笔|笔费)\D*(-?\d+(?:\.\d+)?)/i);
    if (explicitSingle) return Number(explicitSingle[1]) || 0;
    // 兼容“0.9%+6”这种没有写“单笔”的格式，但排除“+4.5%”。
    const withoutPercents = raw.replace(/-?\d+(?:\.\d+)?\s*%/g, "");
    const afterPlus = withoutPercents.match(/[+＋]\s*(-?\d+(?:\.\d+)?)/i);
    if (afterPlus) return Number(afterPlus[1]) || 0;
    return 0;
  }
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : 0;
}

function parseConditionalSingleFee(value: string, avgAmount = 0): number {
  const tier = pickTierFee(value, avgAmount);
  if (tier) return tier.single || 0;
  return parseSingleFee(value);
}

function singleFeeFor(row: RateLike | undefined, kind: "collect" | "payout", avgAmount = 0): number {
  if (!row) return 0;
  const explicit = parseConditionalSingleFee(kind === "collect" ? row.collectSingleFee : row.payoutSingleFee, avgAmount);
  if (explicit) return explicit;
  // 兼容 Google 费率表把“费率% + 单笔”放在同一个单元格的情况。
  return parseConditionalSingleFee(kind === "collect" ? row.collectFee : row.payoutFee, avgAmount);
}

function finiteFeeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function estimateSideFee(amount: number, count: number, percentRate: number, singleFee: number): number {
  // 任何一条异常费率数据都不能把整组三方手续费变成 NaN。
  // 所有输入先做有限数保护；费率数值仍完全来自 Google 费率表。
  const safeAmount = Math.max(0, finiteFeeNumber(amount));
  const safeCount = Math.max(0, finiteFeeNumber(count));
  const safeRate = Math.max(0, finiteFeeNumber(percentRate));
  const safeSingle = Math.max(0, finiteFeeNumber(singleFee));
  const fee = safeAmount * safeRate + safeCount * safeSingle;
  return Number.isFinite(fee) && fee >= 0 ? fee : 0;
}

function normalizeRateCategory(country: string, value?: string): string {
  const text = String(value || "").trim();
  if (!text) return "";

  // 印尼量表的 QRIS 与费率表的 QRIS 必须保持同一个精确类型。
  // inferThirdPartyChannelType 可能把它扩写成“QRIS扫描”，导致精确费率失配后误走通用费率。
  if (normalizeCountryLabel(country).includes("印尼") && /qris/i.test(text)) return "QRIS";

  // 越南费率必须保留具体通道类型；BANKQR、VIETTEL、ZALO 不能再次压成“银行/其他类型”，
  // 否则同一 FASTPay 的 0.60%、0.80%、2.30% 会写入同一个费率索引并互相覆盖。
  if (normalizeCountryLabel(country).includes("越南")) {
    const key = normalizeMatchKey(text);
    if (/bankqr/.test(key)) return "BANKQR";
    if (/viettel/.test(key)) return "VIETTEL";
    if (/zalo/.test(key)) return "ZALO";
    if (/momo/.test(key)) return "MOMO";
    if (/thecao/.test(key)) return "THẺ CÀO";
  }

  return inferThirdPartyChannelType(text, country, text) || text;
}

function normalizeMatchKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/(?:brl|inr|pkr|php|vnd|mmk|ngn|mxn|cop|clp|bdt|usdt|trx)$/gi, "")
    .replace(/[^a-z0-9一-龥]+/g, "")
    .trim();
}

function rateNameKey(country: string, channel: string): string {
  const canonical = canonicalThirdPartyName(channel, country);
  return normalizeMatchKey(canonical || channel);
}

function rateTypeKey(country: string, channelType?: string): string {
  return normalizeMatchKey(normalizeFeeTypeToken(country, channelType));
}

function rateKey(country: string, platform: string, channel: string, channelType?: string): string {
  return `${normalizeMatchKey(normalizeCountryLabel(country))}|||${normalizeMatchKey(canonicalThirdPartyPlatform(country,platform))}|||${rateNameKey(country, channel)}|||${rateTypeKey(country, channelType)}`;
}

function isCoinvidUsdtChannel(country: string, platform: string, channel: string, channelType?: string): boolean {
  const normalizedCountry = normalizeCountryLabel(country);
  const text = `${platform} ${channel} ${channelType || ""}`.toLowerCase();
  return normalizedCountry.includes("越南") && /coinvid/.test(text) && /usdt|trc20|tron/.test(text);
}

function feeFieldIsExplicit(value?: string): boolean {
  const text = String(value || "").trim();
  if (!text || text === "-" || text === "—" || /^(?:n\/a|null|undefined)$/i.test(text)) return false;
  // 数字 0 以及“不用/没有/客户承担”等业务词，都是费率表明确配置的零费率。
  // 它们必须显示为 0，不能被当成缺失费率后再误选其他类型的通用费率。
  if (/^(?:不用|没有|无|免费|免手续费|客户承担|用户承担)$/i.test(text)) return true;
  return /\d/.test(text);
}

function rateHasFee(row: RateLike | undefined): boolean {
  if (!row) return false;
  return [
    row.collectFee,
    row.payoutFee,
    row.totalFee,
    row.collectSingleFee,
    row.payoutSingleFee
  ].some(feeFieldIsExplicit);
}

function rateHasSideFee(row: RateLike | undefined, side: "collect" | "payout"): boolean {
  if (!row) return false;
  return side === "collect"
    ? [row.collectFee, row.collectSingleFee].some(feeFieldIsExplicit)
    : [row.payoutFee, row.payoutSingleFee].some(feeFieldIsExplicit);
}

function rateSideScore(row: RateLike | undefined, side: "collect" | "payout"): number {
  if (!row) return 0;
  let score = rateScore(row);
  if (rateHasSideFee(row, side)) score += 100;
  const opposite = side === "collect" ? "payout" : "collect";
  if (rateHasSideFee(row, opposite)) score += 2;
  return score;
}

function rateScore(row: RateLike | undefined): number {
  if (!row) return 0;
  let score = 0;
  if (parseFeeRate(row.collectFee)) score += 8;
  if (parseFeeRate(row.payoutFee)) score += 8;
  if (parseFeeRate(row.totalFee)) score += 4;
  if (parseSingleFee(row.collectFee)) score += 4;
  if (parseSingleFee(row.payoutFee)) score += 4;
  if (parseSingleFee(row.collectSingleFee)) score += 3;
  if (parseSingleFee(row.payoutSingleFee)) score += 3;
  if (row.platform) score += 2;
  if (row.category) score += 1;
  if (String(row.channelInfo || "").includes("Google费率表直读")) score += 50;
  return score;
}

function mergeRateLike(oldRow: RateLike, newRow: RateLike): RateLike {
  return {
    ...oldRow,
    ...newRow,
    scopePlatformOnly: oldRow.scopePlatformOnly || newRow.scopePlatformOnly || undefined,
    collectFee: oldRow.collectFee || newRow.collectFee,
    payoutFee: oldRow.payoutFee || newRow.payoutFee,
    totalFee: oldRow.totalFee || newRow.totalFee,
    collectSingleFee: oldRow.collectSingleFee || newRow.collectSingleFee,
    payoutSingleFee: oldRow.payoutSingleFee || newRow.payoutSingleFee,
    collectLimit: oldRow.collectLimit || newRow.collectLimit,
    payoutLimit: oldRow.payoutLimit || newRow.payoutLimit,
    category: oldRow.category || newRow.category,
    channelInfo: oldRow.channelInfo || newRow.channelInfo,
    platform: oldRow.platform || newRow.platform
  };
}

function isGame66TeamRateCountry(value: string): boolean {
  const country = normalizeCountryLabel(value);
  return country === "红膏蟹" || country === "香港";
}

function stripGame66ProviderMode(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\s*(?:唤醒|扫码)(?:\s*[-‐‑‒–—﹘﹣－_]\s*新)?\s*$/i, "")
    .trim();
}

function expandRateNameCandidates(country: string, ...values: Array<string | undefined>): string[] {
  const normalizedCountry = normalizeCountryLabel(country);
  const set = new Set<string>();
  const add = (x?: string) => {
    const raw = String(x || "").trim();
    if (!raw) return;
    set.add(raw);
    const canonical = canonicalThirdPartyName(raw, normalizedCountry);
    if (canonical) set.add(canonical);
  };

  values.forEach(add);

  // GAME66 的团队报表把接入方式写在三方名后（如 RushPay唤醒、ARUPI唤醒）。
  // 团队当前没有独立费率页；只用去掉接入方式后能在印度费率表中明确命中的主名。
  // 不删除版本号、不做相似匹配，避免 ICPay2/999Pay 等误借其它三方费率。
  if (isGame66TeamRateCountry(normalizedCountry)) {
    for (const value of values) {
      const provider = stripGame66ProviderMode(String(value || ""));
      if (!provider) continue;
      add(provider);
      add(canonicalThirdPartyName(provider, "印度"));
    }
  }

  const keys = Array.from(set).map((x) => normalizeMatchKey(x)).join("|");

  // 巴西：TOD / TDPay / TodayPay 只做名称归并；实际费率仍从 Google 费率表读取。
  if (/tod|todaypay|tdpay|tdpaybrl/.test(keys)) ["TodayPay", "TOD", "TODPay", "TDPay", "TDPayBRL"].forEach(add);

  // 越南：TopPay 不能再被识别成 OpPay；FASTPAY 只归 FASTPay。TPAY/TRUEPAY 属于马来 TruePay，不能放进越南。
  if (normalizedCountry.includes("越南")) {
    if (/1vnpay|momo/.test(keys)) ["1VNPay", "1VNPay-MoMo", "1VNPay MoMo", "1vnpay - momo", "1vnpay-momo", "1VNPay-QR", "1VNPay QR", "1VNPayBank"].forEach(add);
    if (/toppay|topd|toppayd|top/.test(keys)) ["TopPay", "TopPay-QR", "TopPay QR", "TopPayD", "TopPay D", "TopPayVND-Bank", "TopPayVND Bank", "TopPay(VND)", "TopPay(VND)(四)"].forEach(add);
    if (/fastpay|fast/.test(keys)) ["FASTPay", "FastPay", "FASTPAY", "FASTPay(VND)", "Fast-momo", "FastPay-Momo", "FastPay-MoMo", "FASTPay-MOMO"].forEach(add);
    if (/aqfpay|aqf/.test(keys)) ["AQFPay", "AQFPayVND-Bank", "AQFPay VND Bank", "AQFPay-QR", "AQFPay QR"].forEach(add);
  }

  if (normalizedCountry.includes("印尼")) {
    if (/payingpay|payingpayi|payingpayl|secpay/.test(keys)) ["PayIngPay", "PayIngPayI", "PayIngPayl", "PayingPay", "PayingPayI", "SecPay", "SECPAY-PAYING"].forEach(add);
    if (/safepay|safepay2|safe2pay/.test(keys)) ["SafePay", "SAFEPAY", "SafePay2", "Safe2Pay"].forEach(add);
    if (/yerepay/.test(keys)) ["YerePay", "yerePay", "YEREPAY"].forEach(add);
    if (/sudalink/.test(keys)) ["SudalinkPay", "Sudalink", "sudalinkPay", "SUDALINKPAY", "QRIS (Sudalink)", "BNI-VA (Sudalink)", "BRI-VA (Sudalink)", "CIMB-VA (Sudalink)", "MANDIRI-VA (Sudalink)", "Permata-VA (Sudalink)"].forEach(add);
  }

  if (normalizedCountry.includes("巴西")) {
    if (/vps|vpspay|pix23|pixpay23|pixpay21/.test(keys)) ["VPS", "vps", "VpsPay", "VPSPay", "dp-vpsPay", "wd-vpsPay", "PIX23", "PIXPAY23", "PIXPAY21"].forEach(add);
    if (/megipay|pix25|pixpay25/.test(keys)) ["MegiPay", "dp-megiPay", "wd-megiPay", "MegiPayBRL-PIX", "MegiPay_306", "PIX25", "PIXPAY25"].forEach(add);
    if (/dypay|pix24|pixpay24|pixpay20/.test(keys)) ["DyPay", "DyPayV2", "DyPayBRL", "PIX24", "PIXPAY24", "PIXPAY20"].forEach(add);
  }

  if (normalizedCountry.includes("印度")) {
    // 用户确认：OX2PAY 就是 OXPay。量表和费率表任一边写 OX2Pay/OXPay 都必须命中同一费率。
    if (/ox2pay|oxpay/.test(keys)) ["OXPay", "OXPay-QR", "PAYTM-OXPay", "OX2Pay", "OX2Pay-QR", "PAYTM-OX2Pay"].forEach(add);
    // 已确认的 ArbPay2 BANK / UPI 属于 UPI-QR，不能再借用独立 ArbPay 的费率。
    const confirmedUpiQr = values.some((value) => confirmedIndiaThirdPartyAlias(String(value || ""), normalizedCountry) === "UPI-QR");
    if (!confirmedUpiQr && /arbpay|arbpayinr/.test(keys)) ["ArbPay", "ArbPayINR"].forEach(add);
  }

  if (/usdt|trx|trc20|tron/i.test(keys) || normalizedCountry.includes("USDT")) {
    // USDT 通道不能把所有 USDT 三方互相加入候选，否则 UNIPAY 会误匹配到 TRONPAY 的 4TRX。
    // 按名称精确扩展：UNIPAY=2.9/3.5TRX，TRONPAY=3/4TRX，UPay13/AYPay/UUPay 各走自己的行。
    if (/unipay|uni[-_ ]?pay/.test(keys)) ["UniPayUSDT", "UNIPAY-USDT", "UNIPAY", "UniPay", "UniPayUSDTCU"].forEach(add);
    if (/tronpay|tron[-_ ]?pay/.test(keys)) ["TronPayUSDT", "TRONPAY-USDT", "TRONPAY", "TronPay", "TronPayUSDTCU"].forEach(add);
    if (/uupay|uu[-_ ]?pay/.test(keys)) ["UUPayUSDT", "UUPAY-USDT", "UUPAY", "UUPay", "UUPayUSDTCU"].forEach(add);
    if (/upay13|upay[-_ ]?13/.test(keys)) ["UPay13USDT", "UPay13USDTCU", "UPay13", "UPAY13"].forEach(add);
    if (/aypay|ay[-_ ]?pay/.test(keys)) ["AYPayUSDT", "AYPayUSDTCU", "AYPAY", "AYPay"].forEach(add);
    if (/\bupay\b|^upay$/.test(keys)) ["UPayUSDT", "UPAY", "UPay"].forEach(add);
    if (/^usdt$|trc20/.test(keys)) ["USDT", "TRC20"].forEach(add);
  }

  if (["墨西哥", "哥伦比亚"].some((item) => normalizedCountry.includes(item))) {
    if (/beacon|okeypay|okpay|okaypay/.test(keys)) ["BeaconPay", "Beaconpay", "OKEYPAY", "OkeyPay", "OKPAY", "OkPay", "OKAYPAY", "OkayPay"].forEach(add);
  }
  if (["墨西哥", "哥伦比亚", "智利"].some((item) => normalizedCountry.includes(item))) {
    if (/tod|todaypay|todpay/.test(keys)) ["TodayPay", "TOD", "TODPAY", "TODPay", "todpay", "TODPAY-NEW"].forEach(add);
    if (/starpago/.test(keys)) ["STARPAGO", "StarPago", "starpago"].forEach(add);
    if (/epay/.test(keys)) ["EPay", "EPAY", "Epay", "epay"].forEach(add);
    if (/supefina/.test(keys)) ["Supefina", "SUPEFINA", "supefina", "SUPEFINAPAY", "SUPEFINA-transfiya"].forEach(add);
  }

  if (normalizedCountry.includes("巴基斯坦")) {
    if (/p777|777pay/.test(keys)) ["P777Pay", "P777pay", "777Pay", "P777", "P777-EP", "P777-Jazz"].forEach(add);
    if (/epay|newepay|new[-_ ]?epay/.test(keys)) ["EPay", "Epay", "EPAY", "newEPay", "NewEPay", "new EPay", "new-EPay", "EPay-EP", "EPay-Jazz"].forEach(add);
    if (/deepay|depay|ablepay/.test(keys)) ["DeePay", "DePay", "AblePay"].forEach(add);
    if (/openpay/.test(keys)) ["OpenPay", "Open-EP", "Open-Jazz"].forEach(add);
    if (/okpay/.test(keys)) ["OkPay", "OKPAY", "Ok-EP", "Ok-Jazz"].forEach(add);
    if (/oppay|opay/.test(keys)) ["OpPay", "OPPAY", "OPay", "OpPay-EP", "OpPay-Jazz"].forEach(add);
  }

  return Array.from(set).filter(Boolean);
}

function putRate(map: Map<string, RateLike>, country: string, platform: string, name: string, category: string, row: RateLike) {
  const key = rateKey(country, platform, name, category) + (row.scopePlatformOnly ? `|||scope:${canonicalThirdPartyPlatform(country,platform).toUpperCase()}` : "");
  const existing = map.get(key);
  if (!existing) {
    map.set(key, row);
    return;
  }
  // 费率表经常同一个三方先出现一行“状态/备注”，后面盘口矩阵才有真正手续费。
  // 这里不能先写入空费率后就挡住后面的数据，要优先保留有费率/单笔手续费的版本。
  const merged = mergeRateLike(existing, row);
  map.set(key, rateScore(row) > rateScore(existing) ? mergeRateLike(row, existing) : merged);
}

function rateCountriesCompatible(targetCountry: string, candidateCountry: string): { ok: boolean; score: number } {
  const target = normalizeCountryLabel(targetCountry);
  const candidate = normalizeCountryLabel(candidateCountry);
  if (!target || !candidate) return { ok: false, score: 0 };
  if (target === candidate) return { ok: true, score: 40 };

  // 香港/红膏蟹团队使用 INR 三方，但名称必须先经过上面的严格主名匹配。
  // 仅允许团队页面单向读取印度费率；印度和其它国家绝不会反向读取团队费率。
  if (isGame66TeamRateCountry(target) && candidate === "印度") return { ok: true, score: 20 };

  // V7N：南美三国不允许使用“南美”或其它南美国家作为费率候选。
  // 宁可显示“未匹配”，也绝不能跨币种拿错手续费。
  if (target === "南美" || candidate === "南美" || isStrictSouthAmericaRateCountry(target) || isStrictSouthAmericaRateCountry(candidate)) {
    return { ok: false, score: 0 };
  }
  return { ok: false, score: 0 };
}

function findMatchedRate(rateMap: Map<string, RateLike>, country: string, platform: string, channel: string, channelType?: string, side?: "collect" | "payout"): RateLike | undefined {
  const isUsdtTarget = isUsdtFeeTarget(country, platform, channel, channelType);
  const ch = canonicalThirdPartyName(channel, isUsdtTarget ? "USDT" : country);
  const platformText = canonicalThirdPartyPlatform(country,platform);
  const exactType = normalizeFeeTypeToken(country, channelType);
  const countryCandidates = isUsdtTarget
    ? Array.from(new Set(["USDT通道", "USDT", ...expandRateCountries(country)]))
    : expandRateCountries(country);
  const platformCandidates = platformText ? [platformText, ""] : [""];
  const rawTypeCandidates = isUsdtTarget
    ? [...feeTypeCandidates("USDT", channelType), ...feeTypeCandidates(country, channelType)]
    : feeTypeCandidates(country, channelType);
  const typeCandidates = Array.from(new Set(
    isStrictSouthAmericaRateCountry(country)
      // V7N：南美三国必须先匹配真实通道类型，空类型只能最后兜底。
      ? [...rawTypeCandidates.filter(Boolean), ""]
      : ["", ...rawTypeCandidates]
  ));
  const seen = new Set<string>();
  let bestAny: { row: RateLike; score: number } | null = null;
  let bestWithFee: { row: RateLike; score: number } | null = null;

  for (const countryKey of countryCandidates) {
    for (const platformKey of platformCandidates) {
      for (const typeKey of typeCandidates) {
        const key = rateKey(countryKey, platformKey, ch, typeKey);
        if (seen.has(key)) continue;
        seen.add(key);
        const row = rateMap.get(`${key}|||scope:${platformText.toUpperCase()}`) || rateMap.get(key);
        if (!row) continue;
        if (row.scopePlatformOnly && canonicalThirdPartyPlatform(country,row.platform||"").toUpperCase() !== platformText.toUpperCase()) continue;
        let score = side ? rateSideScore(row, side) : rateScore(row);
        if (isUsdtTarget && (countryKey === "USDT通道" || countryKey === "USDT")) score += 30;
        else if (countryKey === normalizeCountryLabel(country)) score += 14;
        if (platformKey && platformKey === platformText) score += 10;
        if (typeKey && typeKey === exactType) score += 8;
        else if (typeKey && feeTypeMatches(country, exactType, typeKey)) score += 5;
        else if (!typeKey) score += 1;
        if (row.category && feeTypeMatches(country, exactType, row.category)) score += 3;
        if (!bestAny || score > bestAny.score) bestAny = { row, score };
        const hasRequestedFee = side ? rateHasSideFee(row, side) : rateHasFee(row);
        if (hasRequestedFee && (!bestWithFee || score > bestWithFee.score)) bestWithFee = { row, score };
      }
    }
  }

  if (bestWithFee?.row) return bestWithFee.row;

  // 费率表页签/国家/类型名称经常有 NPG-MEXICO、墨西哥01、PSE/SPEI 等写法。
  // 上面的精确索引没命中时，只在“同国家（或南美兜底）+ 同主三方”范围内扫描。
  // 不允许墨西哥/哥伦比亚/智利互相串费率，也不写死任何费率数值。
  const targetCountry = normalizeCountryLabel(country);
  const targetNameKeys = new Set<string>();
  for (const name of expandRateNameCandidates(country, channel)) {
    targetNameKeys.add(rateNameKey(country, name));
    // UPI-QR 等名称在团队上下文与印度上下文中的全局显示别名可能不同；
    // 团队借用印度费率时，同时保留印度作用域下的精确 key。
    if (isGame66TeamRateCountry(targetCountry)) targetNameKeys.add(rateNameKey("印度", name));
  }
  targetNameKeys.add(rateNameKey(country, channel));
  const targetType = normalizeFeeTypeToken(country, channelType);
  const targetPlatform = normalizeMatchKey(platformText);
  const uniqueRows = Array.from(new Set(rateMap.values()));
  let fallbackWithFee: { row: RateLike; score: number } | null = null;
  let fallbackAny: { row: RateLike; score: number } | null = null;

  for (const row of uniqueRows) {
    const rowCountryRaw = row.country || row.sheetName || "";
    const countryMatch = rateCountriesCompatible(targetCountry, rowCountryRaw);
    if (!countryMatch.ok) continue;

    const rowName = rateNameKey(rowCountryRaw, row.thirdParty);
    if (!targetNameKeys.has(rowName)) continue;

    let score = countryMatch.score + (side ? rateSideScore(row, side) : rateScore(row));
    const rowPlatform = normalizeMatchKey(canonicalThirdPartyPlatform(country,row.platform||""));
    if (row.scopePlatformOnly && canonicalThirdPartyPlatform(country,row.platform||"").toUpperCase() !== platformText.toUpperCase()) continue;
    if (targetPlatform && rowPlatform === targetPlatform) score += 20;
    else if (!rowPlatform) score += 4;
    else if (targetPlatform) score -= 3;

    const rowType = normalizeFeeTypeToken(targetCountry, row.category || "");

    if (isStrictSouthAmericaRateCountry(targetCountry)) {
      const genericTargetType = !targetType || targetType === "其他类型" || targetType === "代付类型";
      if (genericTargetType) {
        // 南美没有可识别类型时，只接受真正无类型的费率行；不能随便挑 SPEI/OXXO/PSE 等一行。
        if (rowType) continue;
        score += 6;
      } else if (rowType === targetType) {
        score += 20;
      } else if (rowType && feeTypeMatches(targetCountry, targetType, rowType)) {
        score += 12;
      } else {
        continue;
      }
    } else if (targetType && rowType === targetType) score += 20;
    else if (targetType && rowType && feeTypeMatches(targetCountry, targetType, rowType)) score += 12;
    else if (!rowType) score += 6;
    else if (!targetType || targetType === "其他类型" || targetType === "代付类型") score += 2;
    else score -= 5;

    if (!fallbackAny || score > fallbackAny.score) fallbackAny = { row, score };
    const hasRequestedFee = side ? rateHasSideFee(row, side) : rateHasFee(row);
    if (hasRequestedFee && (!fallbackWithFee || score > fallbackWithFee.score)) fallbackWithFee = { row, score };
  }

  return fallbackWithFee?.row || bestAny?.row || fallbackAny?.row;
}

function buildRateMap(rates: ThirdPartyRateRow[], statuses: ThirdPartyPlatformStatusRow[] = [], scopedPlatformOnly = false): Map<string, RateLike> {
  const map = new Map<string, RateLike>();

  for (const row of rates) {
    const names = expandRateNameCandidates(row.country, row.thirdParty, row.channelInfo, row.category);
    const countryKeys = expandRateCountries(row.country);
    for (const country of countryKeys) {
      for (const name of names) {
        putRate(map, country, "", name, row.category || "", row);

        // V7N：墨西哥/哥伦比亚/智利的 Google 表是一三方多通道费率。
        // 有 category 时绝不能再并入无类型 key，否则 SPEI + Cash + OXXO 会被合成一条假费率。
        if (!isStrictSouthAmericaRateCountry(country) || !String(row.category || "").trim()) {
          putRate(map, country, "", name, "", row);
        }
        // NinePay 同主三方两套费率：把费率表里的 NinePayINR 191 / 213 作为类型索引挂到 NinePay 下。
        if (normalizeCountryLabel(country).includes("印度") && /ninepay\s*inr\s*(191|213)|ninepayinr(191|213)/i.test(`${row.thirdParty} ${row.channelInfo || ""}`)) {
          const text = `${row.thirdParty} ${row.channelInfo || ""}`;
          const typeKey = /213/.test(text) ? "NinePayINR 213" : "NinePayINR 191";
          putRate(map, country, "", "NinePay", typeKey, row);
        }
      }
    }
  }

  for (const row of statuses) {
    const asRate: RateLike = {
      scopePlatformOnly: scopedPlatformOnly || undefined,
      country: row.country,
      platform: row.platform,
      category: row.category || "",
      thirdParty: row.thirdParty,
      collectFee: row.collectFee,
      payoutFee: row.payoutFee,
      totalFee: row.totalFee,
      collectSingleFee: row.collectSingleFee,
      payoutSingleFee: row.payoutSingleFee,
      collectLimit: row.collectLimit,
      payoutLimit: row.payoutLimit,
      channelInfo: "",
      sheetName: row.sheetName
    };
    const names = expandRateNameCandidates(row.country, row.thirdParty, row.category);
    const countryKeys = expandRateCountries(row.country);
    for (const country of countryKeys) {
      for (const name of names) {
        // 盘口状态表最准确：优先按 国家 + 平台 + 三方 + 类型 匹配。
        putRate(map, country, row.platform, name, row.category || "", asRate);
        if (!isStrictSouthAmericaRateCountry(country) || !String(row.category || "").trim()) {
          putRate(map, country, row.platform, name, "", asRate);
        }
        // Scoped accounts may use only the returned platform's own fee fields,
        // never infer a shared national fee or borrow another platform's rate.
        if(scopedPlatformOnly)continue;
        // 再补一个不带平台的兜底，防止量表平台名和费率表平台名细微不同。
        putRate(map, country, "", name, row.category || "", asRate);
        if (!isStrictSouthAmericaRateCountry(country) || !String(row.category || "").trim()) {
          putRate(map, country, "", name, "", asRate);
        }
      }
    }
  }

  // 费率金额、百分比和单笔费用全部以 Google 费率表为唯一来源。
  // 代码这里只负责国家/平台/三方/类型名称归并，不写死任何费率数值。
  return map;
}

function groupKeyForFee(row: FeeCompareRow): string {
  // 异常判断必须按同国家 + 同周期 + 同钱包/通道类型比较，不能把银行代付、钱包代付、QRIS、Virtual Account 混在一起。
  const type = normalizeFeeTypeToken(row.country, row.channelType || "其他类型") || "其他类型";
  return row.date ? `${row.date}|||${row.country}|||${type}` : `${row.country}|||${type}`;
}

function buildFeeCompareRows(comboRows: ComboSummary[], rateRows: ThirdPartyRateRow[], _statusRows: ThirdPartyPlatformStatusRow[], scope: "platform" | "daily", prebuiltRateMap?: Map<string, RateLike>): FeeCompareRow[] {
  // 手续费只从费率主表取。盘口状态只用于“是否接入”，不参与费率匹配。
  const rateMap = prebuiltRateMap || buildRateMap(rateRows, []);
  const rows = comboRows.filter((row) => row.totalAmount > 0 || row.totalCount > 0).map((row) => {
    const [a = "", b = "", c = "", d = "", e = ""] = row.labelParts;
    const date = scope === "daily" ? a : undefined;
    const country = scope === "daily" ? b : a;
    const platform = scope === "daily" ? c : b;
    const rawChannelForFee = scope === "daily" ? d : c;
    const rawTypeForFee = scope === "daily" ? e : d;
    const usdtTarget = isUsdtFeeTarget(country, platform, rawChannelForFee, rawTypeForFee);
    let channel = canonicalThirdPartyName(rawChannelForFee, usdtTarget ? "USDT" : country);
    const channelType = normalizeRateCategory(usdtTarget ? "USDT" : country, rawTypeForFee);
    // 代收、代付分别匹配 Google 费率表。不能先选一条“综合最优”费率行再同时计算两边，
    // 否则同三方存在不同子通道/方向时，会出现费率文字有值但对应手续费为 0。
    const collectRateRow = findMatchedRate(rateMap, country, platform, channel, channelType, "collect");
    const payoutRateRow = findMatchedRate(rateMap, country, platform, channel, channelType, "payout");
    const collectAvgAmount = row.collectCount ? row.collectAmount / row.collectCount : 0;
    const payoutAvgAmount = row.payoutCount ? row.payoutAmount / row.payoutCount : 0;
    const collectFeeRate = rateFor(collectRateRow, "collect", collectAvgAmount);
    const payoutFeeRate = rateFor(payoutRateRow, "payout", payoutAvgAmount);
    const totalFeeRate = collectFeeRate + payoutFeeRate;
    const collectSingleFee = singleFeeFor(collectRateRow, "collect", collectAvgAmount);
    const payoutSingleFee = singleFeeFor(payoutRateRow, "payout", payoutAvgAmount);
    const detailAmounts = row.rows.some(item=>String(item.id || "").startsWith("time:"));
    const mixedCurrency = new Set(row.rows.map(item=>item.currency || "")).size > 1;
    const collectAmountUnavailable = mixedCurrency || (detailAmounts && !Number.isFinite(row.collectAmount));
    const payoutAmountUnavailable = mixedCurrency || (detailAmounts && !Number.isFinite(row.payoutAmount));
    const collectFeeAmount = collectAmountUnavailable ? Number.NaN : estimateSideFee(row.collectAmount, row.collectCount, collectFeeRate, collectSingleFee);
    const payoutFeeAmount = payoutAmountUnavailable ? Number.NaN : estimateSideFee(row.payoutAmount, row.payoutCount, payoutFeeRate, payoutSingleFee);
    // 费率表明确写 0 时显示 0；真正未匹配的通道仍显示“-”，避免把缺失数据伪装成零费率。
    const collectFeeKnownZero = !collectAmountUnavailable && sideHasValue(row.collectAmount, row.collectCount)
      && rateHasSideFee(collectRateRow, "collect")
      && collectFeeRate === 0
      && collectSingleFee === 0;
    const payoutFeeKnownZero = !payoutAmountUnavailable && sideHasValue(row.payoutAmount, row.payoutCount)
      && rateHasSideFee(payoutRateRow, "payout")
      && payoutFeeRate === 0
      && payoutSingleFee === 0;
    const estimatedFee = collectFeeAmount + payoutFeeAmount;
    const effectiveTotalFeeRate = !Number.isFinite(row.totalAmount) ? Number.NaN : row.totalAmount ? estimatedFee / row.totalAmount : totalFeeRate;
    return {
      key: `${row.key}|||fee`,
      date,
      country,
      platform,
      channel,
      channelType,
      collectAmount: row.collectAmount,
      collectCount: row.collectCount,
      payoutAmount: row.payoutAmount,
      payoutCount: row.payoutCount,
      totalAmount: row.totalAmount,
      totalCount: row.totalCount,
      collectShare: 0,
      payoutShare: 0,
      totalShare: 0,
      collectFeeRate,
      payoutFeeRate,
      totalFeeRate,
      effectiveTotalFeeRate,
      collectSingleFee,
      payoutSingleFee,
      collectFeeAmount,
      payoutFeeAmount,
      collectFeeKnownZero,
      payoutFeeKnownZero,
      collectAmountUnavailable,
      payoutAmountUnavailable,
      currency:row.rows[0]?.currency,
      estimatedFee,
      advice: "正常观察",
      level: "normal" as FeeCompareRow["level"]
    };
  });

  const byScope = new Map<string, FeeCompareRow[]>();
  for (const row of rows) {
    const key = groupKeyForFee(row);
    const list = byScope.get(key) || [];
    list.push(row);
    byScope.set(key, list);
  }

  for (const list of byScope.values()) {
    const totalCollect = list.reduce((sum, row) => sum + row.collectAmount, 0);
    const totalPayout = list.reduce((sum, row) => sum + row.payoutAmount, 0);
    const totalVolume = list.reduce((sum, row) => sum + row.totalAmount, 0);
    const totalRates = list.map((row) => row.effectiveTotalFeeRate).filter((rate) => rate > 0);
    const minTotal = totalRates.length ? Math.min(...totalRates) : 0;
    const avgTotal = totalRates.length ? totalRates.reduce((sum, rate) => sum + rate, 0) / totalRates.length : 0;

    for (const row of list) {
      row.collectShare = amountRatio(row.collectAmount,totalCollect);
      row.payoutShare = amountRatio(row.payoutAmount,totalPayout);
      row.totalShare = amountRatio(row.totalAmount,totalVolume);
      const notes: string[] = [];
      let level: FeeCompareRow["level"] = "normal";

      if (!row.collectFeeRate && !row.payoutFeeRate && !row.collectSingleFee && !row.payoutSingleFee) {
        notes.push("未匹配到费率资料");
        level = "missing";
      }

      // 异常提醒按“代收手续费 + 代付手续费 = 合计手续费”换算总有效费率对比。
      // 同国家、同周期、同钱包/通道类型内比较，避免把 LINKAJA 钱包代付和银行代付混在一起。
      const rateText = row.effectiveTotalFeeRate ? `总有效费率 ${formatPercent(row.effectiveTotalFeeRate)}` : "总有效费率 -";
      if (totalRates.length >= 2 && row.effectiveTotalFeeRate && minTotal && row.effectiveTotalFeeRate >= minTotal + 0.0015 && row.totalShare >= 0.12 && row.totalAmount > 0) {
        notes.push(`总费率偏高但跑量多（${rateText}，同类型最低 ${formatPercent(minTotal)}）`);
        level = "danger";
      }
      if (totalRates.length >= 3 && row.effectiveTotalFeeRate && minTotal && avgTotal && row.effectiveTotalFeeRate <= minTotal + 0.0001 && row.effectiveTotalFeeRate < avgTotal - 0.001 && row.totalShare < 0.05 && row.totalAmount > 0) {
        notes.push(`总费率低但跑量少（${rateText}，同类型平均 ${formatPercent(avgTotal)}）`);
        if (level === "normal") level = "warning";
      }

      row.advice = notes.join("；") || "正常观察";
      row.level = level;
    }
  }

  return rows.sort((a, b) => {
    const levelScore = (row: FeeCompareRow) => row.level === "danger" ? 3 : row.level === "warning" ? 2 : row.level === "missing" ? 1 : 0;
    return levelScore(b) - levelScore(a) || b.estimatedFee - a.estimatedFee || b.totalAmount - a.totalAmount;
  });
}

function feeWarningRows(rows: FeeCompareRow[]): FeeCompareRow[] {
  return rows.filter((row) => row.level !== "normal");
}

function pct(value: number, total: number): string {
  return formatPercent(amountRatio(value,total));
}

function cls(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(" ");
}

function countryFromCombo(row: ComboSummary): string {
  return row.labelParts[0] || "未知国家";
}

function countryFromDirection(row: DirectionSummary): string {
  return row.parts[1] || row.parts[0] || "未知国家";
}

function groupCombosByCountry(rows: ComboSummary[]): Array<{ country: string; rows: ComboSummary[]; summary: ReturnType<typeof sumRows> }> {
  return sortCountries(rows.map(countryFromCombo)).map((country) => {
    const countryRows = rows.filter((row) => countryFromCombo(row) === country);
    const rawRows = countryRows.flatMap((row) => row.rows);
    return { country, rows: countryRows, summary: sumRows(rawRows) };
  });
}

function groupDirectionsByCountry(rows: DirectionSummary[]): Array<{ country: string; rows: DirectionSummary[]; amount: number; count: number }> {
  return sortCountries(rows.map(countryFromDirection)).map((country) => {
    const countryRows = rows.filter((row) => countryFromDirection(row) === country);
    return {
      country,
      rows: countryRows,
      amount: countryRows.reduce((sum, row) => sum + row.amount, 0),
      count: countryRows.reduce((sum, row) => sum + row.count, 0)
    };
  });
}

function countryPaneLabel(country: string): string {
  if (isAllUsdtCountryPage(country)) return ALL_USDT_COUNTRY_PAGE;
  if (country.includes("哥伦比亚")) return "NPG哥伦比亚盘口";
  if (country.includes("墨西哥")) return "NPG墨西哥盘口";
  if (country.includes("智利")) return "NPG智利盘口";
  if (country.includes("盘口")) return country;
  if (country.includes("印度")) return `${country}线下盘口`;
  return `${country}盘口`;
}

function rawRowMapCode(row: ThirdPartyVolumeRow): string {
  const raw = row.raw || {};
  for (const [key, value] of Object.entries(raw)) {
    if (/映射|mapping|map/i.test(key)) return String(value || "");
  }
  return "";
}

function classifyIndonesiaBankWalletText(value: string): "银行代付" | "钱包代付" | "QRIS" | "Virtual Account" | "DANA" | "OVO" | "LINKAJA" | "GOPAY" | "" {
  const original = String(value || "");
  const lower = original.toLowerCase();
  const text = lower.replace(/（/g, "(").replace(/）/g, ")").replace(/[\s_：:]+/g, "-");
  const compact = text.replace(/[^a-z0-9]+/g, "");
  // 印尼：具体钱包必须先识别。OVO / DANA / LINKAJA / GOPAY 各自可以有独立费率，不能合并成“其他类型”。
  if (/qris|qr-is/.test(text) || /qris/.test(compact)) return "QRIS";
  if (/link\s*aja|link-aja|linkaja/.test(text) || /linkaja/.test(compact)) return "LINKAJA";
  if (/\bdana\b|(^|[-~_\s])dana([-~_\s]|$)/.test(text) || /dana/.test(compact)) return "DANA";
  if (/\bovo\b|(^|[-~_\s])ovo([-~_\s]|$)/.test(text) || /ovo/.test(compact)) return "OVO";
  if (/go\s*pay|go-pay|gopay|gojek/.test(text) || /gopay|gojek/.test(compact)) return "GOPAY";
  // 已经归类好的中文类型。
  if (/钱包|电子钱包|wallet|ewallet/.test(lower)) return "钱包代付";
  if (/银行|bank|virtual|\bva\b|虚拟账户/.test(lower)) return "银行代付";
  // B~YerePay / B-Click2Pay = 银行；E~YerePay / E-Click2Pay = 泛钱包。
  if (/(^|[^a-z0-9])b\s*[~_-]?\s*yerepay|(^|[^a-z0-9])b\s*[~_-]?\s*paying|(^|[^a-z0-9])b\s*[~_-]?\s*kilipay|(^|[^a-z0-9])b\s*[~_-]?\s*click2?pay|bnin|bmri|brin|cena|bni|bri|mandiri|virtual|\bva\b|-va|permata|cimb|bca|bank/.test(text) || /(bnin|bmri|brin|cena|bni|bri|mandiri|virtualaccount|bank)/.test(compact)) return "银行代付";
  if (/(^|[^a-z0-9])e\s*[~_-]?\s*yerepay|(^|[^a-z0-9])e\s*[~_-]?\s*paying|(^|[^a-z0-9])e\s*[~_-]?\s*kilipay|(^|[^a-z0-9])e\s*[~_-]?\s*click2?pay|ewallet|wallet/.test(text) || /(ewallet|wallet)/.test(compact)) return "钱包代付";
  return "";
}

function normalizeSouthAmericaDisplayType(country: string, type: string, rawRows: ThirdPartyVolumeRow[] = []): string {
  const c = normalizeCountryLabel(country);
  const joined = `${type} ${rawRows.map((row) => `${rawRowMapCode(row)} ${row.channelType || ""} ${row.rawChannel || ""} ${row.channel || ""}`).join(" ")}`
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s_：:]+/g, "-");
  if (c.includes("墨西哥")) {
    if (/spei/.test(joined)) return "SPEI";
    if (/clabe/.test(joined)) return "CLABE";
    if (/oxxo/.test(joined)) return "OXXO";
    if (/codi/.test(joined)) return "CoDi";
    if (/cash|efectivo/.test(joined)) return "Cash";
    if (/bank-card|bankcard|bank|card|tarjeta/.test(joined)) return "Bank Card";
  }
  if (c.includes("哥伦比亚")) {
    if (/bre[-_]?key|brekey/.test(joined)) return "BRE-KEY";
    if (/bre[-_]?b|breb/.test(joined)) return "BRE-B";
    if (/nequi/.test(joined)) return "Nequi";
    if (/pse/.test(joined)) return "PSE";
    if (/transfiya/.test(joined)) return "Transfiya";
    if (/bank|banco/.test(joined)) return "Bank";
    if (/cash|efectivo/.test(joined)) return "Cash";
  }
  if (c.includes("智利")) {
    if (/webpay|card|tarjeta/.test(joined)) return "Card(Webpay)";
    if (/khipu|bank|banco/.test(joined)) return "Bank(Khipu)";
    if (/mach|e[-_ ]?wallet|ewallet|wallet/.test(joined)) return "E-Wallet(Mach)";
    if (/pago46|cash|efectivo/.test(joined)) return "Cash(Pago46)";
  }
  return "";
}

function isPH19VolumeRow(row: ThirdPartyVolumeRow): boolean {
  return /(^|[^a-z0-9])ph\s*[-_]?\s*19([^a-z0-9]|$)|菲律宾\s*19|菲\s*19/i.test(`${row.platform || ""} ${row.sheetName || ""} ${row.rawChannel || ""} ${row.channelType || ""}`);
}

function inferPH19DisplayType(text: string): string {
  const raw = String(text || "").toLowerCase();
  const compact = raw.replace(/[^a-z0-9一-龥]+/g, "");
  if (/gcash/.test(raw) || compact.includes("gcash")) return "GCASH";
  if (/pay\s*maya|paymaya|\bmaya\b/.test(raw) || compact.includes("paymaya")) return "PAYMAYA";
  if (/go\s*tyme|gotyme/.test(raw) || compact.includes("gotyme")) return "GOTYME";
  if (/grab\s*pay|grabpay/.test(raw) || compact.includes("grabpay")) return "GRABPAY";
  if (/bank|银行|银行卡/.test(raw)) return "银行代付";
  return "";
}

function normalizedDisplayChannelType(country: string, type: string, rawRows: ThirdPartyVolumeRow[] = []): string {
  const fallback = normalizeRateCategory(country, type) || String(type || "").trim() || "其他类型";
  const text = rawRows.map((row) => `${row.platform || ""} ${row.sheetName || ""} ${row.channelType || ""} ${row.rawChannel || ""} ${row.channel || ""} ${rawRowMapCode(row)}`).join(" ").toLowerCase();
  const onlyPayout = rawRows.length > 0 && rawRows.every((row) => row.direction === "代付");
  const southAmericaType = normalizeSouthAmericaDisplayType(country, type, rawRows);
  if (southAmericaType) return southAmericaType;
  if (country.includes("巴基斯坦") && onlyPayout) return "代付";
  if (country.includes("印尼")) {
    const kind = classifyIndonesiaBankWalletText(text);
    if (["DANA", "OVO", "LINKAJA", "GOPAY", "QRIS"].includes(kind)) return kind;
    if (kind === "银行代付") return onlyPayout ? "银行代付" : "Virtual Account";
    if (kind === "钱包代付") return "钱包代付";
  }
  if (country.includes("菲律宾") && onlyPayout) {
    // V110：只有 PH19 按 payTypeSubName/PAYTYPE 分类展示；旧菲律宾代付仍合并为「代付」。
    if (rawRows.some(isPH19VolumeRow)) {
      const ph19Type = inferPH19DisplayType(text);
      if (ph19Type) return ph19Type;
      if (fallback && !["其他类型", "其他钱包", "代付", "代付类型"].includes(fallback)) return fallback;
    }
    return "代付";
  }
  if (country.includes("越南")) {
    if (/momo|mo-mo|ví\s*momo|vi\s*momo/.test(text)) return "MOMO";
    if (/fast[-_ ]?momo|fastpay[-_ ]?momo|1vnpay[-_ ]?momo/.test(text)) return "MOMO";
    if (/thẻ|the\s*cao|thecao|cào|nạp\s*thẻ/.test(text)) return "THẺ CÀO";
    if (/viettel/.test(text)) return "VIETTEL";
    if (/zalo/.test(text)) return "ZALO";

    // 旧快照曾把 1VNPay-QR 的后缀压掉并保存成“其他类型”。
    // 对 1VNPay 只在没有明确 MOMO/THẺ CÀO/ZALO/VIETTEL 类型时回退到 BANKQR；
    // 费率数值仍从 Google 费率表实时同步，不在前端硬编码。
    const is1VnPay = rawRows.some((row) => canonicalThirdPartyName(row.channel || row.rawChannel, row.country) === "1VNPay")
      || /1vnpay/.test(text);
    if (is1VnPay && ["", "其他类型", "代付类型"].includes(fallback)) return "BANKQR";
  }
  if (country.includes("马来")) {
    // V88：马来代收 Touch n Go-TP 算 DUITNOW/QR；马来所有代付统一算「银行」。
    const hasPayout = rawRows.some((row) => row.direction === "代付");
    const hasCollect = rawRows.some((row) => row.direction === "代收");
    if (/telcom|telco|telkom/.test(text)) return "Telcom";
    if (hasPayout && !hasCollect) return "银行";
    if (/tng|touch\s*n\s*go|touchngo|touch go|duitnow|duit-now|fpxduitnow|qr|maybankqr/.test(text)) return "DUITNOW/QR";
    if (/shopee|grab|boost/.test(text)) return "Shopee/Grab/Boost";
    if (/fpx|bank|maybank|cimb|rhb|publicbank|ambank|hongleong/.test(text)) return "FPX-BANK";
    if (onlyPayout && (fallback === "其他类型" || fallback === "代付类型" || fallback === "银行代付")) return "银行";
  }
  if (isStrictSouthAmericaRateCountry(country)) {
    // V7N：南美三国的代付也必须保留 Google 费率表里的真实类型
    // （SPEI/CLABE/OXXO/PSE/Khipu...），不能折叠成“银行代付”后再随机兜底。
    return fallback;
  }
  if (fallback === "其他类型" && onlyPayout) return "代付类型";
  return fallback;
}

function normalizedFeeBaseChannelType(row: ThirdPartyVolumeRow): string {
  const inferred = row.channelType || inferThirdPartyChannelType(row.rawChannel || row.channel, row.country, `${row.channel || ""} ${row.rawChannel || ""} ${rawRowMapCode(row)}`) || "其他类型";
  return normalizedDisplayChannelType(row.country, inferred, [row]);
}

function groupFeesByCountry(rows: FeeCompareRow[]): Array<{ country: string; rows: FeeCompareRow[]; amount: number; fee: number; warnings: number }> {
  return sortCountries(rows.map((row) => row.country)).map((country) => {
    const countryRows = rows.filter((row) => row.country === country);
    return {
      country,
      rows: countryRows.sort((a, b) => a.platform.localeCompare(b.platform, "zh-CN", { numeric: true }) || b.estimatedFee - a.estimatedFee || b.totalAmount - a.totalAmount),
      amount: countryRows.reduce((sum, row) => sum + row.totalAmount, 0),
      fee: countryRows.reduce((sum, row) => sum + row.estimatedFee, 0),
      warnings: countryRows.filter((row) => row.level !== "normal").length
    };
  });
}

type FeeSummary = {
  collectFee: number;
  payoutFee: number;
  estimatedFee: number;
  collectRate: number;
  payoutRate: number;
  collectFeeShare: number;
  payoutFeeShare: number;
  totalFeeShare: number;
  collectHasFee: boolean;
  payoutHasFee: boolean;
  collectFeeHint: string;
  payoutFeeHint: string;
  alertRows: FeeCompareRow[];
  missing: number;
};

type FeeSummaryMode = "monthly" | "monthlyPeriod" | "platform" | "daily";

function feePairHint(rows: FeeCompareRow[], side: "collect" | "payout"): string {
  const activeRows = rows.filter((row) =>
    side === "collect"
      ? sideHasValue(row.collectAmount, row.collectCount)
      : sideHasValue(row.payoutAmount, row.payoutCount)
  );
  const seen = new Set<string>();
  const values: string[] = [];

  for (const row of activeRows) {
    const rate = side === "collect" ? row.collectFeeRate : row.payoutFeeRate;
    const single = side === "collect" ? row.collectSingleFee : row.payoutSingleFee;
    const knownZero = side === "collect" ? row.collectFeeKnownZero : row.payoutFeeKnownZero;
    const feeParts: string[] = [];
    if (rate > 0) feeParts.push(formatPercent(rate));
    if (single > 0) feeParts.push(`单笔 ${formatSingleFeeValue(single)}`);
    if (!feeParts.length && knownZero) feeParts.push("0");
    if (!feeParts.length) continue;

    const type = normalizeFeeTypeToken(row.country, row.channelType || "");
    const feeText = feeParts.join(" + ");
    const label = isStrictSouthAmericaRateCountry(row.country) && type && type !== "其他类型" && type !== "代付类型"
      ? `${type}: ${feeText}`
      : feeText;
    if (seen.has(label)) continue;
    seen.add(label);
    values.push(label);
  }

  // 不同子通道是“可选费率”，不是数学相加；必须用 / 分隔。
  return values.join(" / ");
}

function summarizeFeeRows(rows: FeeCompareRow[], totalCollectFee = 0, totalPayoutFee = 0): FeeSummary {
  const mixedCurrency = new Set(rows.map(row=>row.currency || "")).size > 1;
  const collectUnavailable = mixedCurrency || rows.some(row=>row.collectAmountUnavailable);
  const payoutUnavailable = mixedCurrency || rows.some(row=>row.payoutAmountUnavailable);
  // 忽略单条异常 NaN，不能让 TodayPay 等整组三方手续费被污染后显示为 0。
  const collectFee = collectUnavailable ? Number.NaN : rows.reduce((sum, row) => sum + finiteFeeNumber(row.collectFeeAmount), 0);
  const payoutFee = payoutUnavailable ? Number.NaN : rows.reduce((sum, row) => sum + finiteFeeNumber(row.payoutFeeAmount), 0);
  const collectAmount = collectUnavailable ? Number.NaN : rows.reduce((sum, row) => sum + finiteFeeNumber(row.collectAmount), 0);
  const payoutAmount = payoutUnavailable ? Number.NaN : rows.reduce((sum, row) => sum + finiteFeeNumber(row.payoutAmount), 0);
  const estimatedFee = collectFee + payoutFee;
  const totalFee = totalCollectFee + totalPayoutFee;
  const collectHasFee = rows.some((row) => sideHasValue(row.collectAmount, row.collectCount) && (row.collectFeeRate > 0 || row.collectSingleFee > 0 || row.collectFeeAmount > 0 || row.collectFeeKnownZero));
  const payoutHasFee = rows.some((row) => sideHasValue(row.payoutAmount, row.payoutCount) && (row.payoutFeeRate > 0 || row.payoutSingleFee > 0 || row.payoutFeeAmount > 0 || row.payoutFeeKnownZero));
  const alertRows = rows.filter((row) => row.level === "danger" || row.level === "warning").sort((a, b) => b.estimatedFee - a.estimatedFee || b.totalAmount - a.totalAmount);
  return {
    collectFee,
    payoutFee,
    estimatedFee,
    // 合计行可能包含多个钱包/通道，用实际手续费 ÷ 金额显示有效费率，避免同三方被拆开后看不懂。
    collectRate: amountRatio(collectFee,collectAmount),
    payoutRate: amountRatio(payoutFee,payoutAmount),
    collectFeeShare: amountRatio(collectFee,totalCollectFee),
    payoutFeeShare: amountRatio(payoutFee,totalPayoutFee),
    totalFeeShare: amountRatio(estimatedFee,totalFee),
    collectHasFee,
    payoutHasFee,
    collectFeeHint: feePairHint(rows, "collect"),
    payoutFeeHint: feePairHint(rows, "payout"),
    alertRows,
    missing: rows.filter((row) => row.level === "missing").length
  };
}

function emptyFeeSummary(): FeeSummary {
  return { collectFee: 0, payoutFee: 0, estimatedFee: 0, collectRate: 0, payoutRate: 0, collectFeeShare: 0, payoutFeeShare: 0, totalFeeShare: 0, collectHasFee: false, payoutHasFee: false, collectFeeHint: "", payoutFeeHint: "", alertRows: [], missing: 0 };
}

function feeRateText(summary: FeeSummary, side: "collect" | "payout"): string {
  if (!Number.isFinite(side === "collect" ? summary.collectFee : summary.payoutFee)) return "—";
  const hasFee = side === "collect" ? summary.collectHasFee : summary.payoutHasFee;
  const hint = side === "collect" ? summary.collectFeeHint : summary.payoutFeeHint;
  if (!hasFee) return "-";
  return hint || "0";
}

function formatSingleFeeValue(value: number): string {
  if (!Number.isFinite(value)) return "-";
  const rounded = Math.round(value * 1000000) / 1000000;
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 6 }).format(rounded);
}

function feeCompareRateText(row: FeeCompareRow, side: "collect" | "payout"): string {
  const rate = side === "collect" ? row.collectFeeRate : row.payoutFeeRate;
  const single = side === "collect" ? row.collectSingleFee : row.payoutSingleFee;
  const knownZero = side === "collect" ? row.collectFeeKnownZero : row.payoutFeeKnownZero;
  const parts: string[] = [];
  if (rate) parts.push(formatPercent(rate));
  if (single) parts.push(`单笔 ${formatSingleFeeValue(single)}`);
  if (!parts.length && knownZero) return "0";
  return parts.length ? parts.join(" + ") : "-";
}

function feeAmountText(summary: FeeSummary, side: "collect" | "payout"): string {
  if (!Number.isFinite(side === "collect" ? summary.collectFee : summary.payoutFee)) return "—";
  if (side === "collect") return summary.collectHasFee ? formatNumber(summary.collectFee) : "-";
  return summary.payoutHasFee ? formatNumber(summary.payoutFee) : "-";
}

function feeTotalText(summary: FeeSummary): string {
  if (!Number.isFinite(summary.estimatedFee)) return "—";
  return (summary.collectHasFee || summary.payoutHasFee) ? formatNumber(summary.estimatedFee) : "-";
}

function sumComboSummaryRows(rows: ComboSummary[]) {
  const result = rows.reduce((acc, row) => {
    acc.collectAmount += row.collectAmount;
    acc.collectCount += row.collectCount;
    acc.payoutAmount += row.payoutAmount;
    acc.payoutCount += row.payoutCount;
    acc.totalAmount += row.totalAmount;
    acc.totalCount += row.totalCount;
    acc.totalPct += row.totalPct;
    return acc;
  }, { collectAmount: 0, collectCount: 0, payoutAmount: 0, payoutCount: 0, totalAmount: 0, totalCount: 0, totalPct: 0 });
  const amounts = sumRows(rows.flatMap(row=>row.rows));
  return {...result,collectAmount:amounts.collectAmount,payoutAmount:amounts.payoutAmount,totalAmount:amounts.amount};
}

function sumDirectionSummaryRows(rows: DirectionSummary[]) {
  return rows.reduce((acc, row) => {
    acc.amount += row.amount;
    acc.count += row.count;
    return acc;
  }, { amount: 0, count: 0 });
}

function sumDailyCompareSummaryRows(rows: DailyCompareRow[]) {
  const base = sumComboSummaryRows(rows);
  return {
    ...base,
    previousCollectAmount: rows.reduce((sum, row) => sum + row.previousCollectAmount, 0),
    previousPayoutAmount: rows.reduce((sum, row) => sum + row.previousPayoutAmount, 0)
  };
}

function sumFeeCompareSummaryRows(rows: FeeCompareRow[]) {
  return rows.reduce((acc, row) => {
    acc.collectAmount += finiteFeeNumber(row.collectAmount);
    acc.payoutAmount += finiteFeeNumber(row.payoutAmount);
    acc.totalAmount += finiteFeeNumber(row.totalAmount);
    acc.collectFeeAmount += finiteFeeNumber(row.collectFeeAmount);
    acc.payoutFeeAmount += finiteFeeNumber(row.payoutFeeAmount);
    acc.estimatedFee += finiteFeeNumber(row.estimatedFee);
    acc.collectShare += finiteFeeNumber(row.collectShare);
    acc.payoutShare += finiteFeeNumber(row.payoutShare);
    acc.totalShare += finiteFeeNumber(row.totalShare);
    return acc;
  }, { collectAmount: 0, payoutAmount: 0, totalAmount: 0, collectFeeAmount: 0, payoutFeeAmount: 0, estimatedFee: 0, collectShare: 0, payoutShare: 0, totalShare: 0 });
}

function sumRawVolumeRows(rows: ThirdPartyVolumeRow[]) {
  return rows.reduce((acc, row) => {
    acc.amount += row.amount;
    acc.count += row.count;
    return acc;
  }, { amount: 0, count: 0 });
}

function diffPercentText(current: number, previous: number): string {
  if (!previous) return "-";
  return formatPercent((current - previous) / previous);
}

function signedNumberText(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function signedPercentText(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "无基数";
  return `${value > 0 ? "+" : ""}${formatPercent(value)}`;
}

function comparativeStat(label: string, current: number, previous: number, canCompare: boolean, tone: PageStatTone = "default"): PageStatItem {
  if (!canCompare) {
    return { label, value: formatNumber(current), helper: "单日查询显示昨日对比", tone };
  }
  return {
    label,
    value: formatNumber(current),
    delta: current - previous,
    deltaPercent: previous ? (current - previous) / Math.abs(previous) : null,
    compareLabel: "较昨日",
    tone
  };
}

function sideHasValue(amount: number, count: number): boolean {
  return Math.abs(amount || 0) > 0 || Math.abs(count || 0) > 0;
}

function sideNumberText(amount: number, count: number): string {
  return sideHasValue(amount, count) ? formatNumber(amount) : "-";
}

function sideCountText(amount: number, count: number): string {
  return sideHasValue(amount, count) ? formatNumber(count) : "-";
}

function sideShareNode(hasValue: boolean, value: number) {
  return hasValue ? <ShareBar value={value} /> : <span className="muted-cell">-</span>;
}

function sideFeeRateText(summary: FeeSummary, side: "collect" | "payout", amount: number, count: number): string {
  if (!sideHasValue(amount, count)) return "-";
  return feeRateText(summary, side);
}

function sideFeeAmountText(summary: FeeSummary, side: "collect" | "payout", amount: number, count: number): string {
  if (!sideHasValue(amount, count)) return "-";
  return feeAmountText(summary, side);
}

function feeSummaryKey(row: FeeCompareRow, mode: FeeSummaryMode): string {
  if (mode === "daily") return `${row.date || ""}|||${row.country}|||${row.platform}|||${row.channel}`;
  if (mode === "monthlyPeriod") return `${(row.date || "").slice(0, 7)}|||${row.country}|||${row.channel}`;
  if (mode === "platform") return `${row.country}|||${row.platform}|||${row.channel}`;
  return `${row.country}|||${row.channel}`;
}

function comboFeeKey(row: ComboSummary, columns: string[]): string {
  const [first = "", second = "", third = ""] = row.labelParts;
  if (columns.includes("月份")) return `${first}|||${second}|||${third}`;
  if (columns.includes("平台")) return `${first}|||${second}|||${third}`;
  return `${first}|||${second}`;
}

function dailyFeeKey(row: DailyCompareRow): string {
  return `${row.date}|||${row.country}|||${row.platform}|||${row.channel}`;
}

function buildFeeSummaryMap(rows: FeeCompareRow[], mode: FeeSummaryMode): Map<string, FeeSummary> {
  const grouped = new Map<string, FeeCompareRow[]>();
  for (const row of rows) {
    const key = feeSummaryKey(row, mode);
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }
  const totals = summarizeFeeRows(rows);
  const totalCollectFee = totals.collectFee;
  const totalPayoutFee = totals.payoutFee;
  const map = new Map<string, FeeSummary>();
  for (const [key, list] of grouped.entries()) map.set(key, summarizeFeeRows(list, totalCollectFee, totalPayoutFee));
  return map;
}

function buildFeeStatItems(rows: FeeCompareRow[]): Array<[string, string | number]> {
  const summary = summarizeFeeRows(rows);
  // 顶部只保留手续费，费率放到表格每行对比，避免顶部重复占空间。
  return [
    ["代收手续费", feeAmountText(summary, "collect")],
    ["代付手续费", feeAmountText(summary, "payout")],
    ["合计手续费", feeTotalText(summary)]
  ];
}

async function safeReadJson(response: Response, label: string): Promise<any> {
  const text = await response.text();
  if (!text.trim()) throw new Error(`${label}接口没有返回数据（HTTP ${response.status}）`);
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 180);
    throw new Error(`${label}接口返回格式异常（HTTP ${response.status}${preview ? `：${preview}` : ""}）`);
  }
}

const THIRD_PARTY_VOLUME_CACHE_KEY = "hensem:last-good:third-party-volume:v252-submission-success";
const THIRD_PARTY_RATES_CACHE_KEY = "hensem:last-good:third-party-rates:v252-nonempty";
const THIRD_PARTY_VOLUME_QUERY_TIMEOUT_MS = 25_000;
const THIRD_PARTY_VOLUME_QUERY_TIMEOUT_SECONDS = Math.round(THIRD_PARTY_VOLUME_QUERY_TIMEOUT_MS / 1000);
const THIRD_PARTY_RATES_QUERY_TIMEOUT_MS = 20_000;

function ratePayloadUsable(payload: ThirdPartyRatePayload | null | undefined): payload is ThirdPartyRatePayload {
  return Array.isArray(payload?.rates) && payload.rates.length > 0;
}

function ratePayloadFresh(payload: ThirdPartyRatePayload | null | undefined, maxAgeMs = 55 * 60 * 1000): boolean {
  // Never treat an HTTP-200 empty response as a successful fee snapshot.  That
  // used to overwrite the last good cache and made every fee render as zero.
  if (!ratePayloadUsable(payload)) return false;
  const updatedAt = String((payload?.meta as any)?.snapshotUpdatedAt || payload?.meta?.updatedAt || "");
  const time = new Date(updatedAt).getTime();
  return Number.isFinite(time) && Date.now() - time < maxAgeMs;
}

function volumePayloadFresh(payload: ThirdPartyVolumePayload | null | undefined, maxAgeMs = 10 * 60 * 1000): boolean {
  const updatedAt = String((payload?.meta as any)?.snapshotUpdatedAt || payload?.meta?.updatedAt || "");
  const time = new Date(updatedAt).getTime();
  return Number.isFinite(time) && Date.now() - time < maxAgeMs;
}

function readLocalCache<T>(key: string,profile:DashboardProfile|null): T | null {
  return readDashboardDataCache<T>(key,profile);
}

function writeLocalCache(key: string, payload: unknown,profile:DashboardProfile|null) {
  writeDashboardDataCache(key,payload,profile);
}

function attachClientFallbackMessage<T extends { meta?: Record<string, any> }>(payload: T, reason: string): T {
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
    }
  };
}

function localAliasKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[^a-z0-9一-龥]+/g, "");
}

function collapseThirdPartyDisplayName(value: string, country?: string): string {
  const canonical = canonicalThirdPartyName(value, country) || String(value || "").trim();
  if (!canonical) return "未知三方";

  // 这些本身就是主通道名称，不能错误删成 UPI / 空白。
  const preserved = new Set([
    "UPI-QR", "QRIS", "GCASH", "MAYA", "DANA", "OVO", "GOPAY", "LINKAJA",
    "FPX", "DUITNOW", "SPEI", "CLABE", "PIX", "USDT", "TRC20"
  ]);
  if (preserved.has(canonical.toUpperCase())) return canonical;

  // 统一三方下拉只显示主三方；QR/BANK/UPI/PAYTM 等留在 channelType，不再拆成多个三方。
  let collapsed = canonical
    .replace(/\s*[-_/]\s*(QR|BANK|UPI|PAYTM|WALLET2?|EASYPAISA|JAZZCASH|JAZZ|EP|EASY|GCASH|MAYA|DANA|OVO|GOPAY|LINKAJA|FPX|DUITNOW|CLABE|SPEI)(?:\s*\d+)?$/i, "")
    .replace(/\s*\((QR|BANK|UPI|PAYTM|WALLET2?|EASYPAISA|JAZZCASH|JAZZ|EP|EASY|GCASH|MAYA|DANA|OVO|GOPAY|LINKAJA|FPX|DUITNOW|CLABE|SPEI)\)\s*$/i, "")
    .trim();
  if (!collapsed) collapsed = canonical;
  return canonicalThirdPartyName(collapsed, country) || collapsed;
}

function normalizeVolumeRowForDisplay(row: ThirdPartyVolumeRow): ThirdPartyVolumeRow {
  const raw = row.rawChannel || row.channel || "";
  const key = localAliasKey(raw);
  const country = platformDisplayCountry(row.country || "", row.platform);
  const platform = canonicalThirdPartyPlatform(country, row.platform);
  const platformKey = localAliasKey(platform).toUpperCase();
  let channel = row.channel || raw || "未知三方";
  const isIndiaUpiQrPayout = country.includes("印度") && row.direction === "代付" && ["arbupi", "arbbank", "upiqr"].includes(key);

  // V7O：修正已经写进 Supabase 的旧数据。即使旧 row.channel 已经被存成“人工确认”，
  // 只要原始/压缩后的名称是 Arb-UPI、Arb-BANK 或 UPI-QR，就直接恢复为 UPI-QR。
  if (isIndiaUpiQrPayout) {
    channel = "UPI-QR";
  } else if (!["人工确认", "人工充值", "Coinvid USDT"].includes(channel)) {
    // DHANIWIN 只有“裸 UPI”继续算人工确认；UPI-QR2 仍按 ATPay，LOCAL BANK / BankCard 规则不变。
    if (country.includes("印度") && row.direction === "代付" && platformKey === "DHANIWIN" && key === "upi") channel = "人工确认";
    else if (country.includes("印度") && row.direction === "代付" && ["localbank", "bankcard"].includes(key)) channel = "人工确认";
    else if (country.includes("印度") && ["manualrecharge", "人工充值"].includes(key)) channel = "人工充值";
    else channel = canonicalThirdPartyName(raw || channel, country) || channel;
  }

  channel = collapseThirdPartyDisplayName(channel, country);
  if (!channel || channel === "未知三方") channel = collapseThirdPartyDisplayName(row.channel || raw || "未知三方", country);
  const confirmedIndiaUpiQr = confirmedIndiaThirdPartyAlias(raw, country) === "UPI-QR" && !["人工确认", "人工充值", "Coinvid USDT"].includes(channel);
  let channelType = isIndiaUpiQrPayout || confirmedIndiaUpiQr ? "UPI" : (row.channelType || inferThirdPartyChannelType(raw || channel, country, `${channel} ${raw}`) || "其他类型");
  if (channel === "人工确认" || channel === "人工充值") channelType = channel;
  return { ...row, country, platform, channel, channelType };
}

type VolumeFilterPlatform = {country:string;platform:string};

/** The directory contains names only; loading it must not query a report. */
function useVolumeFilterOptions(profile: DashboardProfile | null, userId: string | undefined) {
  const identity = `${userId || ""}:${dashboardScopeIdentity(profile)}`;
  const owner = useRef(identity);owner.current = identity;
  const [stored, setStored] = useState<{identity:string;platforms:VolumeFilterPlatform[]}|null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();let disposed = false, timedOut = false;
    const timer = setTimeout(() => {timedOut = true;controller.abort();}, 30000);
    setLoading(true);setError("");
    void (async () => {
      try {
        const response = await dashboardBusinessFetch("/api/third-party-filter-options", {signal:controller.signal});
        const data = await safeReadJson(response, "平台目录");
        if (!response.ok) throw new Error(data?.message || "平台目录读取失败，请重试。");
        if (!Array.isArray(data?.platforms) || data.platforms.some((row:any) => !row || typeof row.country !== "string" || !row.country.trim() || typeof row.platform !== "string" || !row.platform.trim())) throw new Error("平台目录返回不完整，请重试。");
        if (!disposed && !controller.signal.aborted && owner.current === identity) {
          const scoped = data.platforms.map((row:VolumeFilterPlatform) => withPlatformDisplayCountry(row))
            .filter((row:VolumeFilterPlatform) => dashboardScopeAllows(effectiveDashboardDataScope(profile),row.country,row.platform));
          setStored({identity,platforms:scoped});
        }
      } catch (err) {
        if (!disposed && owner.current === identity) setError(timedOut ? "平台目录读取超时，请重试。" : err instanceof Error ? err.message : "平台目录读取失败，请重试。");
      } finally {clearTimeout(timer);if (!disposed && owner.current === identity) setLoading(false);}
    })();
    return () => {disposed = true;controller.abort();clearTimeout(timer);};
  // Access-token renewal does not reset this permission-scoped directory.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity,retry]);
  return {platforms:stored?.identity===identity?stored.platforms:[],loading,error,
    ready:stored?.identity===identity&&!loading&&!error,reload:()=>setRetry(n=>n+1)};
}

export default function ThirdPartyVolumeDashboard({onOpenOrders}:{onOpenOrders?:()=>void}={}) {
  const { session, profile } = useDashboardAuth();
  const profileScopeIdentity = dashboardScopeIdentity(profile);
  const viewerIdentity = `${session?.user.id || ""}:${profileScopeIdentity}`;
  const filterOptions = useVolumeFilterOptions(profile,session?.user.id);
  const [state, setState] = useState<LoadState>("ready");
  const [payload, setPayload] = useState<ThirdPartyVolumePayload | null>(null);
  const [ratePayload, setRatePayload] = useState<ThirdPartyRatePayload | null>(null);
  const [error, setError] = useState("");
  const [dataNotice, setDataNotice] = useState("");
  const [syncStatus, setSyncStatus] = useState<ClientMonthlyStatus | null>(null);
  const [volumeSyncStatus, setVolumeSyncStatus] = useState<VolumeSyncStatus | null>(null);
  const [knownCountries, setKnownCountries] = useState<string[]>([]);
  const payloadRef = useRef<ThirdPartyVolumePayload | null>(null);
  const loadRequestSequenceRef = useRef(0);
  const loadFlightRef = useRef<AbortController|null>(null);
  const queryIntentRef = useRef(0);
  const queryContextRef = useRef("");
  const queryInFlightRef = useRef(false);
  const [country, setCountry] = useState("");
  const [platformSelections, setPlatformSelections] = useState<string[]>([]);
  const [countrySelections, setCountrySelections] = useState<string[]>([]);
  const [channel, setChannel] = useState("");
  const [direction, setDirection] = useState("");
  const [channelTypeSelections, setChannelTypeSelections] = useState<string[]>([]);
  // V248：筛选条件分成「待查询」和「已应用」两套。
  // 用户修改日期/平台/三方/类型/方向时，不再立即改变当前结果；只有点「查询」才一次性切换。
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [appliedStartDate, setAppliedStartDate] = useState("");
  const [appliedEndDate, setAppliedEndDate] = useState("");
  const [appliedCountrySelections, setAppliedCountrySelections] = useState<string[]>([]);
  const [appliedPlatformSelections, setAppliedPlatformSelections] = useState<string[]>([]);
  const [appliedChannel, setAppliedChannel] = useState("");
  const [appliedDirection, setAppliedDirection] = useState("");
  const [appliedChannelTypeSelections, setAppliedChannelTypeSelections] = useState<string[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [lastQueryAt, setLastQueryAt] = useState("");
  const [hasQueried, setHasQueried] = useState(false);
  const [appliedViewer, setAppliedViewer] = useState("");
  const [mainTab, setMainTab] = useState<VolumeMainTab>("country");
  const [tab, setTab] = useState<TabKey>("daily");
  const [countryPage, setCountryPage] = useState("");
  // 当前页面选择 与 最后一次真正点击「查询」的数据国家分开保存。
  // 这样切换国家页签只是纯 UI 状态变化，不触发旧结果的大量手续费重算。
  const [appliedCountryPage, setAppliedCountryPage] = useState("");
  const [summaryQueryError, setSummaryQueryError] = useState("");
  const [legacySummaryNotice, setLegacySummaryNotice] = useState("");
  const timeQuery = useOrderTimeQuery();

  function invalidateQuery() {
    ++queryIntentRef.current;++loadRequestSequenceRef.current;loadFlightRef.current?.abort();
    queryInFlightRef.current=false;setIsQuerying(false);timeQuery.clearResult();
    setHasQueried(false);setPayload(null);payloadRef.current=null;setVolumeSyncStatus(null);
    setError("");setDataNotice("");setSummaryQueryError("");setLegacySummaryNotice("");setState("ready");
  }

  async function loadTimeRates(intent:number, context:string) {
    const controller=new AbortController();loadFlightRef.current?.abort();loadFlightRef.current=controller;
    const isCurrent=()=>intent===queryIntentRef.current&&context===queryContextRef.current&&!controller.signal.aborted;
    const cached=ratePayloadUsable(ratePayload)?ratePayload:readLocalCache<ThirdPartyRatePayload>(THIRD_PARTY_RATES_CACHE_KEY,profile);
    if(ratePayloadFresh(cached)){if(isCurrent()){setRatePayload(cached);setDataNotice("");}return;}
    try {
      const url=effectiveDashboardDataScope(profile).mode==="all"?"/api/supabase-third-party-rates?includeStatuses=0":"/api/supabase-third-party-rates";
      const response=await dashboardBusinessFetch(url,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(THIRD_PARTY_RATES_QUERY_TIMEOUT_MS)])});
      const next=await safeReadJson(response,"三方费率") as ThirdPartyRatePayload;
      if(!response.ok||!ratePayloadUsable(next))throw new Error("手续费费率暂未载入");
      if(!isCurrent())return;
      setRatePayload(next);writeLocalCache(THIRD_PARTY_RATES_CACHE_KEY,next,profile);setDataNotice("");
    } catch(err) {
      if(!isCurrent())return;
      const retained=!isDashboardDataDenied(err)&&ratePayloadUsable(cached)?cached:null;
      setRatePayload(retained);
      setDataNotice(retained?"手续费读取暂时失败，保留上一份有效费率；订单查询结果不受影响。":"手续费费率暂未载入（不会按 0 展示）；订单查询结果不受影响。");
    }
  }

  async function loadData(silent = false, requestedStart = "", requestedEnd = "", version = "", requestedCountry = "", forceRates = false): Promise<boolean> {
    const requestSequence = ++loadRequestSequenceRef.current;
    const context = queryContextRef.current, controller = new AbortController();
    loadFlightRef.current?.abort();loadFlightRef.current=controller;
    const isCurrent = () => requestSequence===loadRequestSequenceRef.current && context===queryContextRef.current && !controller.signal.aborted;
    const signal = (timeout:number) => AbortSignal.any([controller.signal,AbortSignal.timeout(timeout)]);
    // V247：Supabase 已有数据时，任何瞬时网络/API问题都不能把整页从有数据变成 0。
    if (!silent && !payloadRef.current) setState("loading");
    setError("");
    try {
      const volumeUrl = thirdPartyVolumeApiUrl(requestedStart, requestedEnd, version, requestedCountry);
      const storedRateBeforeFetch = readLocalCache<ThirdPartyRatePayload>(THIRD_PARTY_RATES_CACHE_KEY,profile);
      const cachedRateBeforeFetch = ratePayloadUsable(ratePayload)
        ? ratePayload
        : ratePayloadUsable(storedRateBeforeFetch) ? storedRateBeforeFetch : null;
      const shouldFetchRates = forceRates || !ratePayloadFresh(cachedRateBeforeFetch);
      const ratesUrl = effectiveDashboardDataScope(profile).mode === "all"
        ? "/api/supabase-third-party-rates?includeStatuses=0"
        : "/api/supabase-third-party-rates";
      let rateTransportError = "";

      const [firstVolumeRes, rateRes, statusRes] = await Promise.all([
        dashboardBusinessFetch(volumeUrl, { signal: signal(THIRD_PARTY_VOLUME_QUERY_TIMEOUT_MS) }),
        shouldFetchRates ? dashboardBusinessFetch(ratesUrl, { signal: signal(THIRD_PARTY_RATES_QUERY_TIMEOUT_MS) })
          .catch(error=>{
            if(isDashboardDataDenied(error))throw error;
            rateTransportError = error instanceof Error ? error.message : "网络请求失败";
            return null;
          }) : Promise.resolve(null),
        requestedStart && requestedEnd && effectiveDashboardDataScope(profile).mode==="all" ? dashboardBusinessFetch(thirdPartySyncStatusApiUrl(requestedStart, requestedEnd), { signal: signal(8000) })
          .catch(() => null) : Promise.resolve(null)
      ]);

      let volumeRes = firstVolumeRes;
      let json = await safeReadJson(volumeRes, "三方量") as ThirdPartyVolumePayload;
      // A slower response from an older country/date request must never replace
      // the latest result or mutate its notice/loading state.
      if (!isCurrent()) return false;
      if (!volumeRes.ok) throw new Error((json as any)?.message || "读取 Supabase 三方量失败");

      const volumeRows = json?.rows || [];
      // Server-authorized zero rows are valid after a scope/date change.
      const cacheableCurrentSlice=rangeIncludesCurrentMonth(requestedStart,requestedEnd)
        && (!requestedStart || !requestedEnd || requestedStart===requestedEnd);

      let rateNotice = "";
      let nextRate = cachedRateBeforeFetch;
      if (rateRes && rateRes.ok) {
        try {
          const rateJson = await safeReadJson(rateRes, "三方费率") as ThirdPartyRatePayload;
          if (!ratePayloadUsable(rateJson)) {
            throw new Error("手续费接口返回空费率表");
          }
          nextRate = rateJson;
        } catch (rateError) {
          const reason = rateError instanceof Error ? rateError.message : "手续费数据格式异常";
          rateNotice = cachedRateBeforeFetch
            ? `手续费接口刚才异常，当前保留上一份有效费率：${reason}`
            : `手续费费率暂未载入（不会按 0 展示）：${reason}`;
        }
      } else if (shouldFetchRates) {
        let reason = rateTransportError;
        if (!reason && rateRes) {
          try {
            const rateErrorJson = await safeReadJson(rateRes, "三方费率");
            reason = String(rateErrorJson?.message || `HTTP ${rateRes.status}`);
          } catch (rateError) {
            reason = rateError instanceof Error ? rateError.message : `HTTP ${rateRes.status}`;
          }
        }
        if (!reason) reason = "请求超时或网络中断";
        rateNotice = cachedRateBeforeFetch
          ? `手续费接口刚才失败，当前保留上一份有效费率：${reason}`
          : `手续费费率暂未载入（不会按 0 展示）：${reason}`;
      }
      let nextStatus:VolumeSyncStatus|null = null;
      if (statusRes && statusRes.ok) {
        try { nextStatus = await statusRes.json() as VolumeSyncStatus; } catch { /* 状态不影响主数据 */ }
      }
      if (!isCurrent()) return false;
      setPayload(json);payloadRef.current=json;setRatePayload(nextRate);setDataNotice(rateNotice);setVolumeSyncStatus(nextStatus);
      if(cacheableCurrentSlice)writeLocalCache(THIRD_PARTY_VOLUME_CACHE_KEY,json,profile);
      if(nextRate)writeLocalCache(THIRD_PARTY_RATES_CACHE_KEY,nextRate,profile);
      if (volumeRows.length) {
        const loadedCountries = volumeRows.map((row) => row.country).filter(Boolean);
        setKnownCountries((old) => sortCountries([...old, ...loadedCountries]));
        setStartDate((old) => old || defaultStart(volumeRows));
        setEndDate((old) => old || defaultEnd(volumeRows));
      }
      setState("ready");
      return true;
    } catch (err) {
      if (!isCurrent()) return false;
      const message = err instanceof DOMException && ["AbortError", "TimeoutError"].includes(err.name)
        ? `查询超过 ${THIRD_PARTY_VOLUME_QUERY_TIMEOUT_SECONDS} 秒，请缩短日期范围后重试。`
        : err instanceof Error ? err.message : "读取 Supabase 三方量失败";
      if(isDashboardDataDenied(err)){setPayload(null);payloadRef.current=null;setRatePayload(null);setVolumeSyncStatus(null);setDataNotice("");setError(message);setState("error");return false;}
      const cachedRateCandidate = readLocalCache<ThirdPartyRatePayload>(THIRD_PARTY_RATES_CACHE_KEY,profile);
      const cachedRate = ratePayloadUsable(cachedRateCandidate) ? cachedRateCandidate : null;
      // A transport/API failure is not evidence that the selected date has no
      // data. Keep the last visible result and do not apply the pending filters;
      // overlap with one cached day does not prove coverage of the new range.
      // Only a successful response (including zero rows) may commit that range.
      setRatePayload(cachedRate || (ratePayloadUsable(ratePayload) ? ratePayload : null));
      setError(message);
      setDataNotice(`查询失败，未切换当前结果：${message}`);
      setState("ready");
      return false;
    }
  }

  useEffect(() => { payloadRef.current = payload; }, [payload]);

  useEffect(() => {
    // Only prefill controls. Business data is loaded exclusively on submit.
    const yesterday = sourceDay("Asia/Kolkata", -1);
    const initialCountry = COUNTRY_NAV_TABS.find((name) => dashboardScopeAllows(effectiveDashboardDataScope(profile), name)) || "";
    setStartDate(old=>old||yesterday);setEndDate(old=>old||yesterday);
    setCountryPage(old=>old&&dashboardScopeAllows(effectiveDashboardDataScope(profile),old)?old:initialCountry);
    setPlatformSelections([]);setCountrySelections([]);setChannel("");setChannelTypeSelections([]);setRatePayload(null);
    invalidateQuery();
    return () => {++queryIntentRef.current;++loadRequestSequenceRef.current;loadFlightRef.current?.abort();};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  // Access-token refreshes and identical profile objects are expected during
  // business requests; neither may restart the initial country query.
  }, [viewerIdentity]);


  const rows = useMemo(() => (payload?.rows || []).map(normalizeVolumeRowForDisplay).filter((row) => !isHiddenCountry(row.country)), [payload]);
  const countries = useMemo(() => sortCountries([...knownCountries, ...rows.map((row) => row.country)]), [knownCountries, rows]);
  // 专业后台：国家导航属于固定业务导航，不应该等查询数据回来后才出现。
  // 动态发现的新国家仍可追加，但标准国家页签始终先显示。
  const countryTabs = useMemo(() => {
    const dynamic = countries.filter((item) => !isHiddenCountry(item) && !COUNTRY_NAV_TABS.includes(item));
    const scope=effectiveDashboardDataScope(profile);
    return [...COUNTRY_NAV_TABS, ...sortCountries(dynamic)].filter(name=>dashboardScopeAllows(scope,name));
  }, [countries,profile]);
  const activeCountryPage = countryPage && countryTabs.includes(countryPage) ? countryPage : (mainTab === "country" ? (countryTabs[0] || "") : "");
  queryContextRef.current = `${viewerIdentity}:${activeCountryPage}`;
  const showDailyResult = hasQueried && appliedViewer===viewerIdentity && appliedCountryPage===activeCountryPage;
  const showTimeResult = timeQuery.active && timeQuery.result?.selection.country===activeCountryPage;
  useEffect(() => {
    invalidateQuery();
    return () => {++queryIntentRef.current;++loadRequestSequenceRef.current;loadFlightRef.current?.abort();};
  // Changing the country invalidates a result, not the pending date controls.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCountryPage]);
  // 数据计算只跟最后一次“查询”的国家走；点其它国家页签本身不会重新计算/读取。
  const effectiveCountryFilter = mainTab === "country" ? appliedCountryPage : country;

  const filteredBaseNoDate = useMemo(() => {
    return rows.filter((row) => {
      if (!rowMatchesCountryPage(row, effectiveCountryFilter)) return false;
      if (appliedCountrySelections.length && !appliedCountrySelections.includes(row.country)) return false;
      if (!matchesThirdPartyPlatformSelection(row.country, row.platform, appliedPlatformSelections)) return false;
      if (appliedChannel && row.channel !== appliedChannel) return false;
      if (appliedDirection && row.direction !== appliedDirection) return false;
      return true;
    });
  }, [rows, effectiveCountryFilter, appliedCountrySelections, appliedPlatformSelections, appliedChannel, appliedDirection]);

  const filteredBase = useMemo(() => filteredBaseNoDate.filter((row) => dateMatches(row.date, appliedStartDate, appliedEndDate)), [filteredBaseNoDate, appliedStartDate, appliedEndDate]);

  const isAllDailyPage = false;
  const isAllMonthlyPage = false;
  const optionCountryFilter = mainTab === "country" ? activeCountryPage : country;
  const platformSelectionCountry = optionCountryFilter && !isAllUsdtCountryPage(optionCountryFilter)
    ? optionCountryFilter : countrySelections.length === 1 ? countrySelections[0] : "";
  const optionScopedRowsBeforeCountry = useMemo(() => rows.filter((row) => rowMatchesCountryPage(row, optionCountryFilter)), [rows, optionCountryFilter]);
  const countryFilterOptions = useMemo(() => sortCountries(filterOptions.platforms.map(row=>row.country)), [filterOptions.platforms]);
  const optionScopedRows = useMemo(() => optionScopedRowsBeforeCountry.filter((row) => !countrySelections.length || countrySelections.includes(row.country)), [optionScopedRowsBeforeCountry, countrySelections]);
  const configuredPlatforms = useMemo(() => {
    // The permission-scoped directory is independent of report dates, volume
    // rows and rate-status payloads, including registered zero-volume platforms.
    if (isAllUsdtCountryPage(optionCountryFilter)) return [];
    // Display groups must stay distinct; fee lookup intentionally shares the
    // national Brazil rate key and must not be reused for this dropdown.
    const displayGroup = (value: string) => value === "BR" ? "巴西" : value;
    const targetCountry = displayGroup(optionCountryFilter);
    const selectedCountries = new Set(countrySelections.map(displayGroup));
    return uniq(filterOptions.platforms
      .map(withPlatformDisplayCountry)
      .filter((row) => !targetCountry || displayGroup(row.country) === targetCountry)
      .filter((row) => !selectedCountries.size || selectedCountries.has(displayGroup(row.country)))
      .map((row) => canonicalThirdPartyPlatform(row.country, row.platform)));
  }, [filterOptions.platforms, optionCountryFilter, countrySelections]);
  const timePlatformOptions = useMemo(() => timeQuery.platforms.filter(p=>timePlatformCountry(p)===activeCountryPage).map(timePlatformName), [timeQuery.platforms, activeCountryPage]);
  const timeRangeTimezone = timeQuery.platforms.find(p=>timePlatformCountry(p)===activeCountryPage
    &&(!platformSelections.length||platformSelections.includes(timePlatformName(p))))?.timezone || "Asia/Kolkata";
  const defaultTimeDay = useRef(sourceDay("Asia/Kolkata", -1));
  useEffect(()=>{
    // Metadata can arrive after initial render. Update only untouched defaults;
    // changing country/platform must not overwrite a user's chosen dates.
    const previous=defaultTimeDay.current,next=sourceDay(timeRangeTimezone,-1);
    setStartDate(old=>!old||old===previous?next:old);
    setEndDate(old=>!old||old===previous?next:old);
    defaultTimeDay.current=next;
  },[timeRangeTimezone]);
  const platforms = useMemo(() => isAllUsdtCountryPage(optionCountryFilter)
    ? uniq(filterOptions.platforms.filter(row=>!countrySelections.length||countrySelections.includes(row.country)).map(row=>canonicalThirdPartyPlatform(row.country,row.platform)))
    : configuredPlatforms, [filterOptions.platforms, configuredPlatforms, optionCountryFilter, countrySelections]);
  const hasLegacyPlatformSelection = !timePlatformOptions.length
    || (platformSelections.length ? platformSelections : platforms).some(name => !timePlatformOptions.includes(name));
  const channelOptionRows = useMemo(() => optionScopedRows.filter((row) => matchesThirdPartyPlatformSelection(row.country, row.platform, platformSelections)), [optionScopedRows, platformSelections]);
  const timeOptionsRows = timeQuery.result && timeQuery.mode!=="daily" && timeQuery.result.selection.country===activeCountryPage
    ? timeSourceRows({...timeQuery.result,selection:{...timeQuery.result.selection,channel:"",types:[],direction:""}}).filter(row=>!platformSelections.length||platformSelections.includes(row.platform)) : [];
  const workOrderChannelOptions = useMemo(() => !hasLegacyPlatformSelection || isAllUsdtCountryPage(optionCountryFilter) ? [] : buildWorkOrderDepositView({
    rows: (payload?.workOrderDepositRows || []).filter(row=>!countrySelections.length||countrySelections.includes(workOrderDepositCountry(row.country_code||row.country,row.platform))),
    volumeRows: channelOptionRows,
    start: startDate, end: endDate,
    country: isAllUsdtCountryPage(optionCountryFilter)?"":optionCountryFilter,
    platforms: platformSelections,
  }).providers.map(provider=>provider.channel), [hasLegacyPlatformSelection, payload?.workOrderDepositRows, countrySelections, channelOptionRows, startDate, endDate, optionCountryFilter, platformSelections]);
  const channels = uniq([...channelOptionRows.map(row=>row.channel),...timeOptionsRows.map(row=>row.channel),...workOrderChannelOptions]);
  const channelTypeOptions = uniq([...optionScopedRows.filter((row) => matchesThirdPartyPlatformSelection(row.country, row.platform, platformSelections)).map((row) => row.channelType || "其他类型").filter(Boolean),...timeOptionsRows.map(row=>row.channel_type)]);


  useEffect(() => {
    if (!countrySelections.length || !filterOptions.ready) return;
    const available = new Set(countryFilterOptions);
    const next = countrySelections.filter((item) => available.has(item));
    if (next.length !== countrySelections.length) {
      setCountrySelections(next);
      setPlatformSelections([]);
      setChannel("");
      setChannelTypeSelections([]);
    }
  }, [countryFilterOptions, countrySelections, filterOptions.ready]);

  useEffect(() => {
    if (!platformSelections.length) return;
    if (!filterOptions.ready) return;
    const available = new Set(platforms);
    const next = canonicalThirdPartyPlatformSelections(platformSelectionCountry, platformSelections).filter((item) => available.has(item));
    if (next.length !== platformSelections.length || next.some((item, index) => item !== platformSelections[index])) {
      setPlatformSelections(next);
      setChannel("");
      setChannelTypeSelections([]);
    }
  }, [platforms, platformSelections, platformSelectionCountry, filterOptions.ready]);
  const filtered = useMemo(() => filteredBase.filter((row) => !appliedChannelTypeSelections.length || appliedChannelTypeSelections.includes(row.channelType || "其他类型")), [filteredBase, appliedChannelTypeSelections]);
  const filteredNoDate = useMemo(() => filteredBaseNoDate.filter((row) => !appliedChannelTypeSelections.length || appliedChannelTypeSelections.includes(row.channelType || "其他类型")), [filteredBaseNoDate, appliedChannelTypeSelections]);

  const summary = useMemo(() => sumRows(filtered), [filtered]);
  const countryPageRows = useMemo(() => filtered.filter((row) => appliedCountryPage && rowMatchesCountryPage(row, appliedCountryPage)), [filtered, appliedCountryPage]);
  const countryPageRowsNoDate = useMemo(() => filteredNoDate.filter((row) => appliedCountryPage && rowMatchesCountryPage(row, appliedCountryPage)), [filteredNoDate, appliedCountryPage]);
  const countryPageSummary = useMemo(() => sumRows(countryPageRows), [countryPageRows]);
  const collectionSuccess = useMemo(() => buildCollectionSuccessView({
    snapshots: payload?.collectionSuccessSnapshots || [],
    volumeRows: rows.filter(row => rowMatchesCountryPage(row, appliedCountryPage)
      && (!appliedCountrySelections.length || appliedCountrySelections.includes(row.country))
      && matchesThirdPartyPlatformSelection(row.country, row.platform, appliedPlatformSelections)),
    start: appliedStartDate, end: appliedEndDate,
    country: isAllUsdtCountryPage(appliedCountryPage) ? "" : appliedCountryPage,
    countries: appliedCountrySelections, platforms: appliedPlatformSelections, provider: appliedChannel,
    types: appliedChannelTypeSelections.length ? appliedChannelTypeSelections : isAllUsdtCountryPage(appliedCountryPage) ? ["USDT"] : [],
    enabled: appliedDirection !== "代付", error: payload?.collectionSuccessError,
  }), [payload?.collectionSuccessSnapshots, payload?.collectionSuccessError, rows, appliedCountryPage, appliedStartDate, appliedEndDate, appliedCountrySelections, appliedPlatformSelections, appliedChannel, appliedChannelTypeSelections, appliedDirection]);
  const withdrawSuccess = useMemo(() => buildCollectionSuccessView({
    snapshots: payload?.collectionSuccessSnapshots || [],
    volumeRows: rows.filter(row => rowMatchesCountryPage(row, appliedCountryPage)
      && (!appliedCountrySelections.length || appliedCountrySelections.includes(row.country))
      && matchesThirdPartyPlatformSelection(row.country, row.platform, appliedPlatformSelections)),
    start: appliedStartDate, end: appliedEndDate,
    country: isAllUsdtCountryPage(appliedCountryPage) ? "" : appliedCountryPage,
    countries: appliedCountrySelections, platforms: appliedPlatformSelections, provider: appliedChannel,
    types: appliedChannelTypeSelections.length ? appliedChannelTypeSelections : isAllUsdtCountryPage(appliedCountryPage) ? ["USDT"] : [],
    sourceSystems: ["WITHDRAW_REVIEW"], enabled: appliedDirection !== "代收", error: payload?.collectionSuccessError,
  }), [payload?.collectionSuccessSnapshots, payload?.collectionSuccessError, rows, appliedCountryPage, appliedStartDate, appliedEndDate, appliedCountrySelections, appliedPlatformSelections, appliedChannel, appliedChannelTypeSelections, appliedDirection]);
  const withdrawPending = useMemo(() => buildWithdrawPendingView({
    snapshots: payload?.withdrawPendingSnapshots || [],
    volumeRows: rows.filter(row => rowMatchesCountryPage(row, appliedCountryPage)
      && (!appliedCountrySelections.length || appliedCountrySelections.includes(row.country))
      && matchesThirdPartyPlatformSelection(row.country, row.platform, appliedPlatformSelections)),
    start: appliedStartDate,
    end: appliedEndDate,
    country: isAllUsdtCountryPage(appliedCountryPage) ? "" : appliedCountryPage,
    platforms: appliedPlatformSelections,
    provider: appliedChannel,
    error: payload?.withdrawPendingError,
  }), [payload?.withdrawPendingSnapshots, payload?.withdrawPendingError, rows, appliedCountryPage, appliedStartDate, appliedEndDate, appliedCountrySelections, appliedPlatformSelections, appliedChannel]);
  const workOrderDeposit = useMemo(() => buildWorkOrderDepositView({
    rows: payload?.workOrderDepositRows || [],
    volumeRows: rows.filter(row => rowMatchesCountryPage(row, appliedCountryPage)
      && (!appliedCountrySelections.length || appliedCountrySelections.includes(row.country))
      && matchesThirdPartyPlatformSelection(row.country, row.platform, appliedPlatformSelections)),
    start: appliedStartDate,
    end: appliedEndDate,
    country: isAllUsdtCountryPage(appliedCountryPage) ? "" : appliedCountryPage,
    platforms: appliedPlatformSelections,
    provider: appliedChannel,
    error: payload?.workOrderDepositError,
  }), [payload?.workOrderDepositRows, payload?.workOrderDepositError, rows, appliedCountryPage, appliedStartDate, appliedEndDate, appliedCountrySelections, appliedPlatformSelections, appliedChannel]);
  const withdrawActual = useMemo(() => buildWithdrawActualView({
    rows: payload?.withdrawActualRows || [],
    volumeRows: rows.filter(row => rowMatchesCountryPage(row, appliedCountryPage)
      && (!appliedCountrySelections.length || appliedCountrySelections.includes(row.country))
      && matchesThirdPartyPlatformSelection(row.country, row.platform, appliedPlatformSelections)),
    start: appliedStartDate,
    end: appliedEndDate,
    country: isAllUsdtCountryPage(appliedCountryPage) ? "" : appliedCountryPage,
    platforms: appliedPlatformSelections,
    provider: appliedChannel,
    error: payload?.withdrawActualError,
  }), [payload?.withdrawActualRows, payload?.withdrawActualError, rows, appliedCountryPage, appliedStartDate, appliedEndDate, appliedCountrySelections, appliedPlatformSelections, appliedChannel]);
  const countryPageMonthlyRows = useMemo(() => {
    const existing = aggregateCombo(countryPageRows, (row) => [row.country, row.channel]);
    const keys = new Set(existing.map(row => collectionSuccessProviderKey(row.labelParts[0], row.labelParts[1])));
    // 成功率快照本身没有资金量，不能凭它制造 0 / 0 的虚假三方行。
    // 代付中、工单、实际到账则是独立业务指标，即使主量表没有记录也必须保留。
    const providerOnlyRows: ComboSummary[] = [];
    const appendProviderOnly = (prefix: string, providers: Array<{ key: string; country: string; channel: string }>) => {
      for (const provider of providers) {
        if (keys.has(provider.key)) continue;
        keys.add(provider.key);
        providerOnlyRows.push({
          key: `${prefix}:${provider.key}`, labelParts: [provider.country, provider.channel], rows: [],
          collectAmount: 0, collectCount: 0, payoutAmount: 0, payoutCount: 0,
          totalAmount: 0, totalCount: 0, collectPct: 0, payoutPct: 0, totalPct: 0,
        });
      }
    };
    appendProviderOnly("pending-only", withdrawPending.providers);
    appendProviderOnly("deposit-only", workOrderDeposit.providers);
    if (collectionSuccessCountry(appliedCountryPage) !== "印度") appendProviderOnly("actual-only", withdrawActual.providers);
    return [...existing, ...providerOnlyRows];
  }, [countryPageRows, withdrawPending, workOrderDeposit, withdrawActual, appliedCountryPage]);
  const countryPageMonthlyPeriodRows = useMemo(() => aggregateCombo(countryPageRows, (row) => [row.date.slice(0, 7), row.country, row.channel]), [countryPageRows]);
  const countryPagePlatformRows = useMemo(() => aggregateCombo(countryPageRows, (row) => [row.country, row.platform, row.channel]), [countryPageRows]);
  const countryPageDailyRows = useMemo(() => aggregateDirection(countryPageRows, (row) => [row.date, row.country, row.platform, row.direction, row.channel]), [countryPageRows]);
  const countryPageDailyCompareRows = useMemo(() => buildDailyCompareRows(countryPageRows, countryPageRowsNoDate), [countryPageRows, countryPageRowsNoDate]);
  const monthlyRows = useMemo(() => aggregateCombo(filtered, (row) => [row.country, row.channel]), [filtered]);
  const monthlyPeriodRows = useMemo(() => aggregateCombo(filtered, (row) => [row.date.slice(0, 7), row.country, row.channel]), [filtered]);
  const countryRows = useMemo(() => aggregateCombo(filtered, (row) => [row.country]), [filtered]);
  const platformRows = useMemo(() => aggregateCombo(filtered, (row) => [row.country, row.platform, row.channel]), [filtered]);
  const dailyRows = useMemo(() => aggregateDirection(filtered, (row) => [row.date, row.country, row.platform, row.direction, row.channel]), [filtered]);
  const dailyCompareRows = useMemo(() => buildDailyCompareRows(filtered, filteredNoDate), [filtered, filteredNoDate]);
  const dailyCompareBaseRows = useMemo(() => aggregateCombo(filtered, (row) => [row.date, row.country, row.platform, row.channel, normalizedFeeBaseChannelType(row)]), [filtered]);
  const platformFeeBaseRows = useMemo(() => aggregateCombo(filtered, (row) => [row.country, row.platform, row.channel, normalizedFeeBaseChannelType(row)]), [filtered]);
  // 费率索引只在费率资料变化时重建；切国家页签不会再重建 3900+ 盘口状态索引。
  const feeRateMap = useMemo(() => {
    const restricted=effectiveDashboardDataScope(profile).mode==="selected";
    return buildRateMap(ratePayload?.rates||[],restricted ? ratePayload?.platformStatuses||[] : [],restricted);
  }, [ratePayload?.rates,ratePayload?.platformStatuses,profile]);
  const platformFeeRows = useMemo(() => buildFeeCompareRows(platformFeeBaseRows, ratePayload?.rates || [], [], "platform", feeRateMap), [platformFeeBaseRows, ratePayload?.rates, feeRateMap]);
  const dailyFeeRows = useMemo(() => buildFeeCompareRows(dailyCompareBaseRows, ratePayload?.rates || [], [], "daily", feeRateMap), [dailyCompareBaseRows, ratePayload?.rates, feeRateMap]);
  const feeWarnings = useMemo(() => feeWarningRows(dailyFeeRows), [dailyFeeRows]);
  const countryPageFeeRows = useMemo(() => dailyFeeRows.filter((row) => appliedCountryPage && feeRowMatchesCountryPage(row, appliedCountryPage)), [dailyFeeRows, appliedCountryPage]);
  const isSingleDayQuery = Boolean(appliedStartDate && appliedStartDate === appliedEndDate);
  const comparisonDate = isSingleDayQuery ? dateAdd(appliedStartDate, -1) : "";
  const countryPagePreviousRows = useMemo(() => {
    if (!comparisonDate || !appliedCountryPage) return [];
    return filteredNoDate.filter((row) => row.date === comparisonDate && rowMatchesCountryPage(row, appliedCountryPage));
  }, [filteredNoDate, comparisonDate, appliedCountryPage]);
  const countryPagePreviousSummary = useMemo(() => sumRows(countryPagePreviousRows), [countryPagePreviousRows]);
  const countryPagePreviousFeeBaseRows = useMemo(
    () => aggregateCombo(countryPagePreviousRows, (row) => [row.date, row.country, row.platform, row.channel, normalizedFeeBaseChannelType(row)]),
    [countryPagePreviousRows]
  );
  const countryPagePreviousFeeRows = useMemo(
    () => buildFeeCompareRows(countryPagePreviousFeeBaseRows, ratePayload?.rates || [], [], "daily", feeRateMap),
    [countryPagePreviousFeeBaseRows, ratePayload?.rates, feeRateMap]
  );
  const dashboardFeeStatItems = useMemo(() => buildFeeStatItems(dailyFeeRows.length ? dailyFeeRows : platformFeeRows), [dailyFeeRows, platformFeeRows]);

  const aliasRows = useMemo(() => {
    return Object.entries(payload?.aliasMap || {})
      .map(([name, aliases]) => ({ name, aliases: aliases as string[] }))
      .filter((item) => item.name !== "未知三方" && item.aliases.length)
      .sort((a, b) => b.aliases.length - a.aliases.length || a.name.localeCompare(b.name, "zh-CN"));
  }, [payload]);

  const anomalyRows = useMemo(() => {
    const feeWarning = feeWarnings.slice(0, 60).map((row) => `${row.date || "累计"} ${row.country} ${row.platform} ${row.channel}${row.channelType ? ` / ${row.channelType}` : ""}：${row.advice}，总跑量占比 ${formatPercent(row.totalShare)}，总有效费率 ${row.effectiveTotalFeeRate ? formatPercent(row.effectiveTotalFeeRate) : "-"}，合计手续费 ${formatNumber(row.estimatedFee)}`);
    const aliasWarning = aliasRows.filter((row) => row.aliases.length >= 3).map((row) => `${row.name}：识别到 ${row.aliases.length} 个别名（${row.aliases.slice(0, 8).join(" / ")}）`);
    const volumeHigh = platformRows
      .filter((row) => row.totalAmount >= 1000000 || row.totalCount >= 1000)
      .slice(0, 25)
      .map((row) => `${row.labelParts.join(" / ")}：量级较高，金额 ${formatNumber(row.totalAmount)}，笔数 ${formatNumber(row.totalCount)}`);
    return [...feeWarning, ...aliasWarning, ...volumeHigh].slice(0, 150);
  }, [feeWarnings, aliasRows, platformRows]);


  function applyDateShortcut(mode: DateShortcut) {
    const selectedDate = startDate || endDate || appliedEndDate;
    const range = sourceShortcutDateRange(mode,selectedDate,timeRangeTimezone);
    setStartDate(range.start);
    setEndDate(range.end);
    timeQuery.setStartClock("00:00:00");timeQuery.setEndClock("23:59:59");
  }

  function shiftDateRange(periods: number) {
    const baseStart = startDate || endDate || appliedStartDate || defaultEnd(rows) || sourceDay(timeRangeTimezone);
    const baseEnd = endDate || startDate || appliedEndDate || baseStart;
    const startObj = new Date(`${baseStart}T00:00:00Z`);
    const endObj = new Date(`${baseEnd}T00:00:00Z`);
    if (Number.isNaN(startObj.getTime()) || Number.isNaN(endObj.getTime())) return;
    const spanDays = Math.max(1, Math.floor((endObj.getTime() - startObj.getTime()) / 86400000) + 1);
    const delta = periods * spanDays;
    setStartDate(dateAdd(baseStart, delta));
    setEndDate(dateAdd(baseEnd, delta));
  }

  async function runQuery() {
    // React state is not synchronous; the ref also blocks rapid double-clicks
    // before the disabled button has rendered.
    if (queryInFlightRef.current) return;
    queryInFlightRef.current = true;
    const intent = ++queryIntentRef.current, context = queryContextRef.current;
    loadFlightRef.current?.abort();
    const isCurrent = () => intent===queryIntentRef.current && context===queryContextRef.current;
    const queryStart = startDate || endDate || appliedStartDate || sourceDay(timeRangeTimezone,-1);
    const queryEnd = endDate || startDate || appliedEndDate || queryStart;
    setIsQuerying(true);
    setSummaryQueryError("");
    try {
      const queryCountry = mainTab === "country" ? activeCountryPage : "";
      if (!queryCountry) throw new Error("请选择国家后查询。");
      if (filterOptions.loading) throw new Error("正在读取平台目录，请稍后查询。");
      if (filterOptions.error) throw new Error(`平台目录暂未载入：${filterOptions.error}`);
      if (!filterOptions.ready || !platforms.length) throw new Error("当前国家没有可查询的平台，请检查平台配置或权限。");
      if (platformSelections.some(name=>!platforms.includes(name))) throw new Error("所选平台已不在当前目录，请重新选择。");
      if (timeQuery.optionsLoading) throw new Error("正在读取可查询的平台，请稍后查询。");
      if (timeQuery.optionsError) throw new Error(`平台明细权限暂未载入：${timeQuery.optionsError}。请重新读取平台后查询。`);
      const querySource = summaryQuerySource({basis:timeQuery.mode==="success"?"success":"created",
        start:`${queryStart}T${timeQuery.startClock}`,end:`${queryEnd}T${timeQuery.endClock}`,
        platforms:platformSelections,availablePlatforms:platforms,detailPlatforms:timePlatformOptions});
      if (querySource === "orders") {
        const loaded = await timeQuery.run({country:queryCountry,platforms:[...platformSelections],availablePlatforms:[...platforms],channel,types:[...channelTypeSelections],direction,
          start:`${queryStart}T${timeQuery.startClock}`,end:`${queryEnd}T${timeQuery.endClock}`});
        if (loaded && isCurrent()) {setLegacySummaryNotice("");void loadTimeRates(intent,context);}
        return;
      }
      const loaded = await loadData(true, queryStart, queryEnd, "", queryCountry, true);
      if (!isCurrent()) return;
      if (!loaded) {
        // 查询失败只保留上一份成功数据，不能改写用户当前选择的国家页签。
        setHasQueried(Boolean(payloadRef.current));
        return;
      }
      timeQuery.showDaily();
      setLegacySummaryNotice("当前选择含仅有日汇总的平台；本次整组使用原有日汇总口径，未按订单创建／成功时间重新计算。");
      // 只有点击查询后才把所有筛选条件应用到结果。
      setAppliedStartDate(queryStart);
      setAppliedEndDate(queryEnd);
      setAppliedCountrySelections([...countrySelections]);
      setAppliedPlatformSelections(canonicalThirdPartyPlatformSelections(platformSelectionCountry, platformSelections));
      setAppliedChannel(channel);
      setAppliedDirection(direction);
      setAppliedChannelTypeSelections([...channelTypeSelections]);
      setAppliedCountryPage(queryCountry);
      setAppliedViewer(viewerIdentity);
      setLastQueryAt(new Date().toISOString());
      setHasQueried(true);
    } catch (err) {
      if (isCurrent()) setSummaryQueryError(err instanceof Error ? err.message : "查询失败，请重试。");
    } finally {
      if (isCurrent()) {queryInFlightRef.current = false;setIsQuerying(false);}
    }
  }

  const hasPendingQuery = timeQuery.active && timeQuery.result ? Boolean(
    timeQuery.result.selection.basis !== timeQuery.mode
    || timeQuery.result.selection.start !== `${startDate}T${timeQuery.startClock}`
    || timeQuery.result.selection.end !== `${endDate}T${timeQuery.endClock}`
    || timeQuery.result.selection.country !== activeCountryPage
    || timeQuery.result.selection.platforms.join("|||") !== platformSelections.join("|||")
    || timeQuery.result.selection.channel !== channel
    || timeQuery.result.selection.direction !== direction
    || timeQuery.result.selection.types.join("|||") !== channelTypeSelections.join("|||")
    || (timeQuery.mode === "success" && (timeQuery.result.selection.createdStart !== timeQuery.createdStart || timeQuery.result.selection.createdEnd !== timeQuery.createdEnd))
  ) : Boolean(
    startDate !== appliedStartDate
    || endDate !== appliedEndDate
    || countrySelections.join("|||") !== appliedCountrySelections.join("|||")
    || platformSelections.join("|||") !== appliedPlatformSelections.join("|||")
    || channel !== appliedChannel
    || direction !== appliedDirection
    || channelTypeSelections.join("|||") !== appliedChannelTypeSelections.join("|||")
    || (mainTab === "country" && activeCountryPage !== appliedCountryPage)
    || timeQuery.mode === "success" || timeQuery.startClock !== "00:00:00" || timeQuery.endClock !== "23:59:59"
  );

  const appliedCoverage = useMemo(() => {
    const status = volumeSyncStatus;
    if (!status) return { expected: 0, loaded: 0, incomplete: false, complete: false, failed: 0, historical: false };
    if (status.historyTasks > 0) {
      return {
        expected: status.historyTasks,
        loaded: status.historySuccess,
        incomplete: !status.historyComplete,
        complete: status.historyComplete,
        failed: status.historyFailed,
        historical: true
      };
    }
    const start = appliedStartDate || status.start || "";
    const end = appliedEndDate || status.end || start;
    let expectedDays = 1;
    if (start && end) {
      const a = new Date(`${start}T00:00:00Z`);
      const b = new Date(`${end}T00:00:00Z`);
      if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime()) && b >= a) expectedDays = Math.floor((b.getTime() - a.getTime()) / 86400000) + 1;
    }
    const complete = status.collectDays >= expectedDays && status.payoutDays >= expectedDays;
    return { expected: expectedDays * 2, loaded: Math.min(status.collectDays, expectedDays) + Math.min(status.payoutDays, expectedDays), incomplete: !complete, complete, failed: 0, historical: false };
  }, [volumeSyncStatus, appliedStartDate, appliedEndDate]);

  const initialLoading = state === "loading" && !payload;
  return (
    <div className={cls("work-order-module third-party-volume-module", initialLoading && "is-initial-loading")}>
      {state==="error"&&!timeQuery.active&&<p className="business-query-error" role="alert">日汇总暂未载入：{error}。可重试查询，或使用已接入平台的订单明细查询。</p>}
      {hasQueried && initialLoading && (
        <div className="volume-soft-loading">
          <span className="volume-soft-loading-spinner" />
          <div><b>正在载入数据</b></div>
        </div>
      )}
      {dataNotice && (
        <div className="volume-stable-notice">
          <span className="volume-stable-dot" />
          <div><b>{timeQuery.active?"日汇总/费率提示（不代表订单明细查询失败）：":""}{dataNotice}</b></div>
        </div>
      )}
      <section className="third-party-tab-panel">
        <div className="tab-group-row main-tab-row">
          <button className={cls("module-tab", mainTab === "country" && "active")} onClick={() => { setMainTab("country"); }}>各国家量</button>
          <button className={cls("module-tab", mainTab === "rates" && "active")} onClick={() => { setMainTab("rates"); }}>各国家费率</button>
        </div>
        {mainTab === "country" && (
          <>
            <div className="tab-group-row child-tab-row country-tab-row volume-country-pane-row">
              {countryTabs.map((item) => (
                <button key={item} className={cls("module-tab", activeCountryPage === item && "active")} onClick={() => {
                  if (item===activeCountryPage) return;
                  invalidateQuery();
                  setCountryPage(item);
                  setCountrySelections([]);
                  setPlatformSelections([]);
                  setChannel("");
                  setChannelTypeSelections([]);
                  // A country page never displays another country's result.
                }}>{countryPaneLabel(item)}</button>
              ))}
              {hasQueried && !countryTabs.length && <span className="muted-text">暂无国家数据</span>}
            </div>
          </>
        )}
      </section>

      {mainTab === "rates" && <ThirdPartyRatesDashboard embedded />}

      {mainTab === "country" && (
        <>

      <form className="filter-card volume-search-card" aria-label="三方量搜索" onSubmit={event=>{event.preventDefault();void runQuery();}}>
        <div className="filters work-filters volume-time-filter-grid">
          <div className="field"><label>时间口径</label><select className="input" aria-label="时间口径" value={timeQuery.mode==="success"?"success":"created"} onChange={e=>{timeQuery.setMode(e.target.value as "created"|"success");}}><option value="created">创建时间</option><option value="success">成功时间</option></select></div>
          <label className="field volume-date-field">开始时间<input className="input" required type="datetime-local" step="1" value={startDate?`${startDate}T${timeQuery.startClock}`:""} onChange={e=>{setStartDate(e.target.value.slice(0,10));if(e.target.value.includes("T"))timeQuery.setStartClock(e.target.value.split("T")[1]);}} /></label>
          <label className="field volume-date-field">结束时间<input className="input" required type="datetime-local" step="1" value={endDate?`${endDate}T${timeQuery.endClock}`:""} onChange={e=>{setEndDate(e.target.value.slice(0,10));if(e.target.value.includes("T"))timeQuery.setEndClock(e.target.value.split("T")[1]);}} /></label>
          
          {isAllUsdtCountryPage(activeCountryPage) && <VolumeMultiSelect label="国家" options={countryFilterOptions} value={countrySelections} onChange={(value) => { setCountrySelections(value); setPlatformSelections([]); setChannel(""); setChannelTypeSelections([]); }} placeholder="全部国家" />}
          <VolumeMultiSelect key={`platform:${activeCountryPage}`} label="平台" options={platforms} value={platformSelections} onChange={(value) => { setPlatformSelections(canonicalThirdPartyPlatformSelections(platformSelectionCountry, value)); setChannel(""); setChannelTypeSelections([]); }} placeholder="全部平台" />
          <VolumeSingleSelect label="统一三方" options={channels} value={channel} onChange={value=>{setChannel(value);setChannelTypeSelections([]);}} placeholder="全部三方" />
          <VolumeMultiSelect key={`type:${activeCountryPage}`} label="类型 / 钱包" options={channelTypeOptions} value={channelTypeSelections} onChange={setChannelTypeSelections} placeholder="全部类型" />
          <label className="field">业务方向<select className="input" value={direction} onChange={(event) => setDirection(event.target.value)}><option value="">全部方向</option><option value="代收">代收</option><option value="代付">代付</option></select></label>
        </div>
      <div className="volume-search-actions">
      <div className="quick-row date-shortcuts volume-date-shortcuts">
        <span>快捷日期：</span>
        <button type="button" onClick={() => applyDateShortcut("today")}>今天</button>
        <button type="button" onClick={() => applyDateShortcut("yesterday")}>昨日</button>
        <button type="button" onClick={() => applyDateShortcut("beforeYesterday")}>前日</button>
        <button type="button" onClick={() => applyDateShortcut("thisWeek")}>本周</button>
        <button type="button" onClick={() => applyDateShortcut("lastWeek")}>上周</button>
        <button type="button" onClick={() => applyDateShortcut("thisMonth")}>本月</button>
        <button type="button" onClick={() => applyDateShortcut("lastMonth")}>上月</button>
      </div>
        <button className="primary-btn volume-query-btn" type="submit" disabled={isQuerying}>{isQuerying ? "查询中…" : "查询"}</button>
      </div>
        <div aria-live="polite">
          {filterOptions.loading && <p role="status">正在读取平台目录…</p>}
          {filterOptions.error && <p className="business-query-error" role="alert">{filterOptions.error} <button className="mini-btn" type="button" onClick={filterOptions.reload}>重新读取平台目录</button></p>}
          {filterOptions.ready && !platforms.length && <p role="status">当前国家暂无可查询平台。</p>}
        </div>
        {(timePlatformOptions.length>0||timeQuery.optionsLoading||timeQuery.optionsError)&&<TimeQueryExtra query={timeQuery} showTimeHelp={timePlatformOptions.length>0} hideExplanation/>}
      </form>

      {summaryQueryError&&<p className="business-query-error" role="alert">{summaryQueryError} 当前结果未被替换。</p>}
      {!summaryQueryError&&timeQuery.error&&<p className="business-query-error" role="alert">{timeQuery.error}{timeQuery.active&&" 当前结果未被替换。"}</p>}
      {showTimeResult&&timeQuery.result&&<TimeRangeVolumeResult result={timeQuery.result} paused={timeQuery.busy} rateRows={ratePayload?.rates||[]} feeRateMap={feeRateMap}/>}

      {!showDailyResult && !showTimeResult && mainTab === "country" && (
        <section className="dashboard-query-empty volume-query-empty" aria-live="polite">
          <span className="dashboard-query-empty-icon">↗</span>
          <div><strong>查询后查看国家资金数据</strong><p>选择时间范围、平台或三方后查询。</p></div>
        </section>
      )}

        {showDailyResult && !showTimeResult && mainTab === "country" && <CountryVolumeSinglePage country={appliedCountryPage} rows={countryPageRows} summary={countryPageSummary} previousSummary={countryPagePreviousSummary} monthlyRows={countryPageMonthlyRows} feeRows={countryPageFeeRows} previousFeeRows={countryPagePreviousFeeRows} canCompare={isSingleDayQuery} collectionSuccess={collectionSuccess} withdrawSuccess={withdrawSuccess} withdrawPending={withdrawPending} workOrderDeposit={workOrderDeposit} withdrawActual={withdrawActual} dateRangeLabel={`${appliedStartDate || "-"} 至 ${appliedEndDate || "-"}`} />}
        </>
      )}
    </div>
  );
}


function VolumeSingleSelect({ label, options, value, onChange, placeholder }: { label: string; options: string[]; value: string; onChange: (value: string) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const visibleOptions = options.filter(item => item.toLowerCase().includes(search.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent | TouchEvent) => {
      if (event.target instanceof Node && !boxRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("touchstart", outside);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("touchstart", outside); };
  }, [open]);
  const choose = (next: string) => { onChange(next); setOpen(false); setSearch(""); buttonRef.current?.focus(); };
  return <div ref={boxRef} className="field multi-field volume-multi-field volume-single-field" onKeyDown={event=>{
    if (event.key==="Escape") { event.preventDefault(); setOpen(false); buttonRef.current?.focus(); }
  }}>
    <label>{label}</label>
    <button ref={buttonRef} className="multi-button" type="button" aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setSearch("");setOpen(!open);}}>
      <span>{value||placeholder}</span><span className="multi-caret">▾</span>
    </button>
    {open&&<div className="multi-menu volume-multi-menu" role="dialog" aria-label={`选择${label}`}>
      <input className="multi-search" aria-label={`搜索${label}`} placeholder={`搜索${label}`} autoFocus value={search} onChange={event=>setSearch(event.target.value)} onKeyDown={event=>{
        if(event.key==="Enter") { event.preventDefault(); if(visibleOptions.length===1)choose(visibleOptions[0]); }
      }}/>
      <div className="multi-list">
        <button type="button" className="multi-option volume-single-option" aria-pressed={!value} onClick={()=>choose("")}>{placeholder}</button>
        {visibleOptions.map(item=><button type="button" className="multi-option volume-single-option" aria-pressed={item===value} key={item} onClick={()=>choose(item)}>{item}</button>)}
        {!visibleOptions.length&&<div className="multi-empty">没有匹配的三方</div>}
      </div>
    </div>}
  </div>;
}

function VolumeMultiSelect({ label, options, value, onChange, placeholder }: { label: string; options: string[]; value: string[]; onChange: (value: string[]) => void; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const boxRef = useRef<HTMLDivElement | null>(null);

  const visibleOptions = useMemo(() => {
    const q = search.trim().toLowerCase();
    return options.filter((item) => !q || item.toLowerCase().includes(q));
  }, [options, search]);

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

  function toggle(item: string) {
    if (value.includes(item)) onChange(value.filter((x) => x !== item));
    else onChange([...value, item]);
  }

  function selectVisible() {
    onChange(uniq([...value, ...visibleOptions]));
  }

  function clearAll() {
    onChange([]);
    setSearch("");
  }

  return (
    <div ref={boxRef} className="field multi-field volume-multi-field">
      <label>{label}</label>
      <button className="multi-button" type="button" aria-label={label} aria-expanded={open} onClick={() => {setSearch("");setOpen((x) => !x);}}>
        <span>{filterLabel(value, placeholder)}</span>
        <span className="multi-caret">▾</span>
      </button>
      {open && (
        <div className="multi-menu volume-multi-menu">
          <input className="multi-search" aria-label={`搜索${label}`} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`搜索${label}`} onKeyDown={event=>{if(event.key==="Enter")event.preventDefault();}} />
          <div className="multi-actions">
            <button type="button" onClick={selectVisible}>全选当前</button>
            <button type="button" onClick={clearAll}>清空</button>
            <button type="button" onClick={() => setOpen(false)}>完成</button>
          </div>
          <div className="multi-list">
            {visibleOptions.map((item) => (
              <label className="multi-option" key={item}>
                <input type="checkbox" checked={value.includes(item)} onChange={() => toggle(item)} />
                <span>{item}</span>
              </label>
            ))}
            {!visibleOptions.length && <div className="multi-empty">当前范围暂无选项</div>}
          </div>
          <div className="multi-footer">已选 {value.length} 项；会按当前国家范围提供可选项。</div>
        </div>
      )}
    </div>
  );
}


function OrderSuccessCell({value,hint}:{value?:ReturnType<CollectionSuccessView["compare"]>["current"];hint?:string}) {
  if(!value || value.rate==null) return <span className="order-rate-empty" title={hint||"现有日汇总没有完整提现订单分母；请使用已接入的创建时间查询。"}>—<small>{hint?"不适用":"待明细接入"}</small></span>;
  return <span className="order-rate-value" title={`成功 ${formatNumber(value.success)} 笔 ÷ 创建 ${formatNumber(value.submitted)} 笔；仅基于已入库订单`}>{formatPercent(value.rate)}<small>{formatNumber(value.success)} / {formatNumber(value.submitted)} 笔</small></span>;
}

function PlatformCoverageDialog({result,onClose}:{result:TimeQueryResult;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),coverage=timePlatformCoverage(result);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  return <dialog ref={dialog} className="platform-coverage-dialog" aria-label="平台查询情况" onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="platform-coverage-content">
      <div className="detail-modal-header"><div><h3>平台查询情况</h3><p>{result.selection.country} · {result.selection.start.replace("T"," ")} 至 {result.selection.end.replace("T"," ")}</p></div><button autoFocus type="button" className="modal-close-btn" onClick={onClose}>关闭</button></div>
      {([
        ["尚无可查明细",coverage.unavailable,"已在平台目录登记，但当前没有可查询的已上传明细；不代表已确认漏采。"],
        ["已查询、当前条件无数据",coverage.empty,"已读取该平台，但没有匹配本次时间和筛选条件的订单。"],
        ["本次有数据",coverage.contributing,""]
      ] as const).map(([title,names,hint])=><section className="platform-coverage-group" key={title}><h4>{title}（{names.length}）</h4>{names.length?<ul>{names.map(name=><li key={name}>{name}</li>)}</ul>:<p>无</p>}{hint&&names.length>0&&<small>{hint}</small>}</section>)}
    </div>
  </dialog>;
}

function ComparisonCoverageDialog({issues,onClose}:{issues:TimeComparisonIssue[];onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  return <dialog ref={dialog} className="platform-coverage-dialog" aria-label="涨跌对比核验" onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div className="platform-coverage-content">
      <div className="detail-modal-header"><div><h3>涨跌对比核验</h3><p>当前金额与工单保留。核验未通过时，不把缺失明细当成零，也不混用日汇总计算涨跌。</p></div><button autoFocus type="button" className="modal-close-btn" onClick={onClose}>关闭</button></div>
      <ul className="comparison-coverage-list">{issues.map((issue,index)=><li key={index}>
        <strong>{issue.period==="current"?"本期":"对比期"} · {issue.date} · {issue.platform} {issue.direction}</strong>
        <p>{issue.reason}{issue.expected!==undefined&&<> 采集记录 {formatNumber(issue.expected)} 笔；已入库 {issue.stored===undefined?"未确认":formatNumber(issue.stored)} 笔。</>}</p>
      </li>)}</ul>
    </div>
  </dialog>;
}

function TimeRangeVolumeResult({result,rateRows,feeRateMap,paused=false}:{result:TimeQueryResult;rateRows:ThirdPartyRateRow[];feeRateMap:Map<string,RateLike>;paused?:boolean}) {
  const [selected,setSelected]=useState<string|null>(null);
  const [workOrders,setWorkOrders]=useState<{result:TimeQueryResult;rows:WorkOrderDepositRow[];error?:string}|null>(null);
  const [coverageOpen,setCoverageOpen]=useState(false);
  const [comparisonOpen,setComparisonOpen]=useState(false);
  const comparison=useOrderTimeComparison(result,paused);
  const data=useMemo(()=>timeVolumeData(result),[result]);
  const previousData=useMemo(()=>comparison.status==="ready"&&comparison.previous?timeVolumeData(comparison.previous):null,[comparison]);
  const workOrderCountry=collectionSuccessCountry(result.selection.country);
  const showWorkOrders=!["香港","红膏蟹",ALL_USDT_COUNTRY_PAGE].includes(workOrderCountry);
  useEffect(()=>{
    if(!showWorkOrders)return;
    const controller=new AbortController(),s=result.selection;
    const query=new URLSearchParams({country:s.country,start:s.start.slice(0,10),end:s.end.slice(0,10)});
    void (async()=>{
      try {
        const response=await dashboardBusinessFetch(`/api/third-party-workorder-metrics?${query}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(15000)])});
        const payload=await safeReadJson(response,"工单统计");
        if(!response.ok || payload?.basis!=="daily" || payload?.start!==query.get("start") || payload?.end!==query.get("end") || payload?.country!==s.country || !Array.isArray(payload?.rows))throw new Error("工单统计暂未载入，请重新查询。");
        if(!controller.signal.aborted)setWorkOrders({result,rows:payload.rows});
      } catch {
        if(!controller.signal.aborted)setWorkOrders({result,rows:[],error:"工单统计暂未载入，请重新查询。"});
      }
    })();
    return ()=>controller.abort();
  },[result,showWorkOrders]);
  const workOrderDeposit=useMemo(()=>{
    if(!showWorkOrders)return undefined;
    const current=workOrders?.result===result?workOrders:null,s=result.selection;
    return {...buildWorkOrderDepositView({rows:current?.rows||[],volumeRows:data.rows,start:s.start.slice(0,10),end:s.end.slice(0,10),
      country:s.country,platforms:s.platforms,provider:s.channel,error:current?.error||(!current?"工单统计载入中…":undefined)}),
      basisHint:"工单按所选日期整日统计，独立于订单小时／成功时间筛选。"};
  },[result,showWorkOrders,workOrders,data]);
  const monthlyRows=useMemo(()=>{
    const rows=aggregateCombo(data.rows,row=>[row.country,row.channel]);
    const keys=new Set(rows.map(row=>workOrderDepositProviderKey(row.labelParts[0],row.labelParts[1])));
    for(const p of workOrderDeposit?.providers||[])if(!keys.has(p.key)){
      keys.add(p.key);rows.push({key:`deposit-only:${p.key}`,labelParts:[p.country,p.channel],rows:[],
        collectAmount:0,collectCount:0,payoutAmount:0,payoutCount:0,totalAmount:0,totalCount:0,collectPct:0,payoutPct:0,totalPct:0});
    }
    return rows;
  },[data,workOrderDeposit]);
  const feeRows=useMemo(()=>rateRows.length ? buildFeeCompareRows(aggregateCombo(data.rows,row=>[row.date,row.country,row.platform,row.channel,normalizedFeeBaseChannelType(row)]),rateRows,[],"daily",feeRateMap) : [],[data,rateRows,feeRateMap]);
  const previousFeeRows=useMemo(()=>previousData&&rateRows.length?buildFeeCompareRows(aggregateCombo(previousData.rows,row=>[row.date,row.country,row.platform,row.channel,normalizedFeeBaseChannelType(row)]),rateRows,[],"daily",feeRateMap):[],[previousData,rateRows,feeRateMap]);
  const s=result.selection,range=`${s.start.replace("T"," ")} 至 ${s.end.replace("T"," ")}`;
  const hint=data.successRateHint||"成功笔数 ÷ 创建笔数；仅统计已入库订单，不代表采集已完整。";
  const platforms=timePlatformCoverage(result);
  const coverage=!s.platforms.length&&platforms.unavailable.length
    ? `可查 ${platforms.queried.length} / 全部 ${platforms.expected.length} 平台 · 点击查看` : "点击查看平台名单";
  useEffect(()=>{setSelected(null);setCoverageOpen(false);setComparisonOpen(false);},[result]);
  return <>
    {comparison.status==="unavailable"&&<div className="comparison-coverage-notice"><button type="button" className="mini-btn" onClick={()=>setComparisonOpen(true)}>涨跌暂不可比 · 查看原因</button></div>}
    <CountryVolumeSinglePage country={s.country} rows={data.rows} previousRows={previousData?.rows} summary={sumRows(data.rows)} previousSummary={sumRows(previousData?.rows||[])}
      monthlyRows={monthlyRows} feeRows={feeRows} previousFeeRows={previousFeeRows} canCompare={!!previousData} dateRangeLabel={range}
      compareLabel={timeComparisonLabel(s)} comparisonHint={comparison.status==="error"?"核验暂未载入":comparison.status==="unavailable"?"数据待核实": "对比中…"}
      collectionSuccess={data.collectionSuccess} withdrawSuccess={data.withdrawSuccess} orderRateHint={hint}
      platformCoverage={coverage} onPlatformCoverage={()=>setCoverageOpen(true)}
      workOrderDeposit={workOrderDeposit}
      withdrawActual={data.withdrawActual} withdrawPending={data.withdrawPending} onView={row=>setSelected(row.labelParts[1])}/>
    {workOrders?.result===result&&workOrders.error&&<p role="alert">{workOrders.error}</p>}
    {selected&&<OrderRecordModal result={result} channel={selected} onClose={()=>setSelected(null)}/>}
    {coverageOpen&&<PlatformCoverageDialog result={result} onClose={()=>setCoverageOpen(false)}/>}
    {comparisonOpen&&<ComparisonCoverageDialog issues={comparison.issues||[]} onClose={()=>setComparisonOpen(false)}/>}
  </>;
}

function CountryVolumeSinglePage({ country, rows, previousRows, summary, previousSummary, monthlyRows, feeRows, previousFeeRows, canCompare, compareLabel, comparisonHint, dateRangeLabel, collectionSuccess, withdrawPending, workOrderDeposit, withdrawActual, withdrawSuccess, orderRateHint, platformCoverage, onPlatformCoverage, onView }: { country: string; rows: ThirdPartyVolumeRow[]; previousRows?: ThirdPartyVolumeRow[]; summary: ReturnType<typeof sumRows>; previousSummary: ReturnType<typeof sumRows>; monthlyRows: ComboSummary[]; feeRows: FeeCompareRow[]; previousFeeRows: FeeCompareRow[]; canCompare: boolean; compareLabel?: string; comparisonHint?: string; dateRangeLabel: string; collectionSuccess?: CollectionSuccessView; withdrawPending?: WithdrawPendingView; workOrderDeposit?: WorkOrderDepositView; withdrawActual?: WithdrawActualView; withdrawSuccess?: CollectionSuccessView; orderRateHint?: string; platformCoverage?: string; onPlatformCoverage?:()=>void; onView?: (row: ComboSummary) => void }) {
  const fees = summarizeFeeRows(feeRows);
  const previousFees = summarizeFeeRows(previousFeeRows);
  const netAmount = summary.collectAmount - summary.payoutAmount - fees.estimatedFee;
  const previousNetAmount = previousSummary.collectAmount - previousSummary.payoutAmount - previousFees.estimatedFee;
  const collectFeeAvailable = Number.isFinite(summary.collectAmount) && Number.isFinite(fees.collectFee) && (!summary.collectAmount || fees.collectHasFee);
  const payoutFeeAvailable = Number.isFinite(summary.payoutAmount) && Number.isFinite(fees.payoutFee) && (!summary.payoutAmount || fees.payoutHasFee);
  const allFeesAvailable = collectFeeAvailable && payoutFeeAvailable && Number.isFinite(summary.amount);
  const previousCollectFeeAvailable=Number.isFinite(previousSummary.collectAmount)&&Number.isFinite(previousFees.collectFee)&&(!previousSummary.collectAmount||previousFees.collectHasFee);
  const previousPayoutFeeAvailable=Number.isFinite(previousSummary.payoutAmount)&&Number.isFinite(previousFees.payoutFee)&&(!previousSummary.payoutAmount||previousFees.payoutHasFee);
  const unavailableFeeStat = (label: string): PageStatItem => ({ label, value: "—", helper: "手续费费率暂未载入", tone: "fee" });
  const volumeStat = (...args:Parameters<typeof comparativeStat>):PageStatItem => {
    const comparable=args[3]&&Number.isFinite(args[1])&&Number.isFinite(args[2]);
    const item=comparativeStat(args[0],args[1],args[2],comparable,args[4]);
    return !Array.isArray(item) ? {...item,compareLabel:compareLabel||item.compareLabel,
      helper:compareLabel?`${compareLabel} · ${canCompare?"暂无可比数据":comparisonHint||"对比中…"}`:orderRateHint?"所选时间段 · 已入库订单":item.helper} : item;
  };
  return (
    <div className="country-volume-page range-volume-page">
      <PageStatStrip items={[
        compareLabel?volumeStat("主三方",uniq(rows.map(row=>row.channel)).length,uniq((previousRows||[]).map(row=>row.channel)).length,canCompare):{ label: "主三方", value: uniq(rows.map((row) => row.channel)).length, helper: "当前筛选范围", tone: "default" },
        { ...(compareLabel?volumeStat("平台",uniq(rows.map(row=>row.platform)).length,uniq((previousRows||[]).map(row=>row.platform)).length,canCompare):{value:uniq(rows.map(row=>row.platform)).length}) as Exclude<PageStatItem,[string,string|number]>,label:"平台",helper:platformCoverage||"当前有数据的平台",onClick:onPlatformCoverage,tone:"default" },
        volumeStat("代收金额", summary.collectAmount, previousSummary.collectAmount, canCompare, "collect"),
        volumeStat("代收笔数", summary.collectCount, previousSummary.collectCount, canCompare, "collect"),
        volumeStat("代付金额", summary.payoutAmount, previousSummary.payoutAmount, canCompare, "payout"),
        volumeStat("代付笔数", summary.payoutCount, previousSummary.payoutCount, canCompare, "payout"),
        collectFeeAvailable ? volumeStat("代收手续费", fees.collectFee, previousCollectFeeAvailable?previousFees.collectFee:NaN, canCompare, "fee") : unavailableFeeStat("代收手续费"),
        payoutFeeAvailable ? volumeStat("代付手续费", fees.payoutFee, previousPayoutFeeAvailable?previousFees.payoutFee:NaN, canCompare, "fee") : unavailableFeeStat("代付手续费"),
        allFeesAvailable ? volumeStat("合计手续费", fees.estimatedFee, previousCollectFeeAvailable&&previousPayoutFeeAvailable?previousFees.estimatedFee:NaN, canCompare, "fee") : unavailableFeeStat("合计手续费"),
        allFeesAvailable
          ? { ...volumeStat("业务净额", netAmount, previousCollectFeeAvailable&&previousPayoutFeeAvailable?previousNetAmount:NaN, canCompare, "net") as Exclude<PageStatItem, [string, string | number]>, ...(!compareLabel?{helper:orderRateHint || canCompare ? "代收－代付－手续费" : "代收－代付－手续费 · 单日可对比昨日"}:{}) }
          : { label: "业务净额", value: "—", helper: "手续费费率载入后计算", tone: "net" }
      ]} />
      <MonthlyTable
        title=""
        subtitle=""
        rows={monthlyRows}
        columns={["统一三方"]}
        columnIndexes={[1]}
        stickyFirstColumn
        feeRows={feeRows}
        collectionSuccess={collectionSuccess}
        withdrawPending={withdrawPending}
        workOrderDeposit={workOrderDeposit}
        withdrawActual={collectionSuccessCountry(country)==="印度"?undefined:withdrawActual}
        withdrawSuccess={withdrawSuccess}
        orderRateHint={orderRateHint}
        onView={onView}
        paginated
      />
    </div>
  );
}

function ChangeBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="change-badge neutral">无昨日</span>;
  const clsName = value >= 0 ? "up" : "down";
  return <span className={cls("change-badge", clsName)}>{value >= 0 ? "+" : ""}{formatPercent(value)}</span>;
}

function PlatformVolumeTable({ title, subtitle, rows, feeRows }: { title: string; subtitle: string; rows: PlatformCompareRow[]; feeRows: FeeCompareRow[] }) {
  const [selected, setSelected] = useState<PlatformCompareRow | ComboSummary | null>(null);
  const [selectedFeeIssues, setSelectedFeeIssues] = useState<{ title: string; rows: FeeCompareRow[] } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const pager = usePagination(rows, true);
  const shownSummary = sumComboSummaryRows(pager.shown);
  const totalSummary = sumComboSummaryRows(rows);

  function feeForPlatform(row: PlatformCompareRow): FeeSummary {
    const matched = feeRows.filter((item) => item.date === row.date && item.country === row.country && item.platform === row.platform);
    const totalCollectFee = feeRows.reduce((sum, item) => sum + item.collectFeeAmount, 0);
    const totalPayoutFee = feeRows.reduce((sum, item) => sum + item.payoutFeeAmount, 0);
    return summarizeFeeRows(matched, totalCollectFee, totalPayoutFee);
  }

  function childLines(row: PlatformCompareRow) {
    const grouped = aggregateCombo(row.rows, (raw) => [raw.country, raw.platform, raw.channel]);
    return grouped.map((child) => {
      const [country = row.country, platform = row.platform, channel = "未知三方"] = child.labelParts;
      const matched = feeRows.filter((item) => item.date === row.date && item.country === country && item.platform === platform && item.channel === channel);
      const totalCollectFee = feeRows.reduce((sum, item) => sum + item.collectFeeAmount, 0);
      const totalPayoutFee = feeRows.reduce((sum, item) => sum + item.payoutFeeAmount, 0);
      return { ...child, displayChannel: channel, fee: summarizeFeeRows(matched, totalCollectFee, totalPayoutFee) };
    }).filter((child) => child.totalAmount > 0 || child.totalCount > 0).sort((a, b) => b.totalAmount - a.totalAmount || b.totalCount - a.totalCount || String(a.displayChannel).localeCompare(String(b.displayChannel), "zh-CN", { numeric: true }));
  }

  return (
    <div className="panel daily-compare-panel platform-volume-panel">
      <div className="panel-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></div>
      <TablePager total={rows.length} page={pager.page} pageSize={pager.pageSize} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
      <div className="table-wrap work-table-wrap daily-compare-wrap">
        <table>
          <thead><tr><th>日期</th><th>国家</th><th>平台/盘口</th><th className="num">代收金额</th><th>代收占比</th><th className="num">代收笔数</th><th className="num">代付金额</th><th>代付占比</th><th className="num">代付笔数</th><th className="num">合计金额</th><th className="num">合计笔数</th><th>代收费率</th><th className="num">代收手续费</th><th>代付费率</th><th className="num">代付手续费</th><th className="num">合计手续费</th><th>手续费占比</th><th>总占比</th><th>详情</th></tr></thead>
          <tbody>{pager.shown.flatMap((row) => {
            const fee = feeForPlatform(row);
            const children = childLines(row);
            const isOpen = !!expanded[row.key];
            const main = <tr key={row.key} className={fee.alertRows.length ? "fee-warning-main-row" : ""}><td>{row.date}</td><td>{row.country}</td><td className="strong-cell">{row.platform}</td><td className="num">{formatNumber(row.collectAmount)}</td><td><ShareBar value={row.collectPct} /></td><td className="num">{formatNumber(row.collectCount)}</td><td className="num">{formatNumber(row.payoutAmount)}</td><td><ShareBar value={row.payoutPct} /></td><td className="num">{formatNumber(row.payoutCount)}</td><td className="num strong-cell">{formatNumber(row.totalAmount)}</td><td className="num strong-cell">{formatNumber(row.totalCount)}</td><td>{feeRateText(fee, "collect")}</td><td className="num">{feeAmountText(fee, "collect")}</td><td>{feeRateText(fee, "payout")}</td><td className="num">{feeAmountText(fee, "payout")}</td><td className="num">{feeTotalText(fee)}</td><td>{feeShareNode(fee, () => setSelectedFeeIssues({ title: `${row.date} / ${row.country} / ${row.platform}`, rows: fee.alertRows }))}</td><td>{formatPercent(row.totalPct)}</td><td><div className="row-action-group">{children.length > 0 && <button className="mini-btn" onClick={() => setExpanded((old) => ({ ...old, [row.key]: !old[row.key] }))}>{isOpen ? "收起" : "展开"}</button>}<button className="mini-btn" onClick={() => setSelected(row)}>查看</button></div></td></tr>;
            if (!isOpen || !children.length) return [main];
            const childRows = children.map((child) => {
              const childHasCollect = sideHasValue(child.collectAmount, child.collectCount);
              const childHasPayout = sideHasValue(child.payoutAmount, child.payoutCount);
              return <tr key={`${row.key}|||child|||${child.key}`} className="volume-child-row"><td>{row.date}</td><td>{row.country}</td><td>{`↳ ${child.displayChannel || "-"}`}</td><td className="num">{sideNumberText(child.collectAmount, child.collectCount)}</td><td>{sideShareNode(childHasCollect, amountRatio(child.collectAmount,row.collectAmount))}</td><td className="num">{sideCountText(child.collectAmount, child.collectCount)}</td><td className="num">{sideNumberText(child.payoutAmount, child.payoutCount)}</td><td>{sideShareNode(childHasPayout, amountRatio(child.payoutAmount,row.payoutAmount))}</td><td className="num">{sideCountText(child.payoutAmount, child.payoutCount)}</td><td className="num strong-cell">{formatNumber(child.totalAmount)}</td><td className="num strong-cell">{formatNumber(child.totalCount)}</td><td>{sideFeeRateText(child.fee, "collect", child.collectAmount, child.collectCount)}</td><td className="num">{sideFeeAmountText(child.fee, "collect", child.collectAmount, child.collectCount)}</td><td>{sideFeeRateText(child.fee, "payout", child.payoutAmount, child.payoutCount)}</td><td className="num">{sideFeeAmountText(child.fee, "payout", child.payoutAmount, child.payoutCount)}</td><td className="num">{feeTotalText(child.fee)}</td><td>{feeShareNode(child.fee, () => setSelectedFeeIssues({ title: `${row.date} / ${row.country} / ${row.platform} / ${child.displayChannel}`, rows: child.fee.alertRows }))}</td><td>{row.totalAmount ? formatPercent(child.totalAmount / row.totalAmount) : "-"}</td><td><button className="mini-btn" onClick={() => setSelected(child)}>查看</button></td></tr>;
            });
            return [main, ...childRows];
          })}{!pager.shown.length && <tr><td colSpan={19} className="empty">暂无平台量数据</td></tr>}</tbody>
          <tfoot>
            <tr className="summary-row page-summary-row"><td colSpan={3}>当前页汇总</td><td className="num">{formatNumber(shownSummary.collectAmount)}</td><td>{pct(shownSummary.collectAmount, shownSummary.totalAmount)}</td><td className="num">{formatNumber(shownSummary.collectCount)}</td><td className="num">{formatNumber(shownSummary.payoutAmount)}</td><td>{pct(shownSummary.payoutAmount, shownSummary.totalAmount)}</td><td className="num">{formatNumber(shownSummary.payoutCount)}</td><td className="num strong-cell">{formatNumber(shownSummary.totalAmount)}</td><td className="num strong-cell">{formatNumber(shownSummary.totalCount)}</td><td>{shownSummary.collectAmount ? formatPercent((feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.platform === item.platform)).reduce((sum, item) => sum + item.collectFeeAmount, 0)) / shownSummary.collectAmount) : '-'}</td><td className="num">{formatNumber(feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.platform === item.platform)).reduce((sum, item) => sum + item.collectFeeAmount, 0))}</td><td>{shownSummary.payoutAmount ? formatPercent((feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.platform === item.platform)).reduce((sum, item) => sum + item.payoutFeeAmount, 0)) / shownSummary.payoutAmount) : '-'}</td><td className="num">{formatNumber(feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.platform === item.platform)).reduce((sum, item) => sum + item.payoutFeeAmount, 0))}</td><td className="num">{formatNumber(feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.platform === item.platform)).reduce((sum, item) => sum + item.collectFeeAmount + item.payoutFeeAmount, 0))}</td><td>{formatPercent(totalSummary.totalAmount ? feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.platform === item.platform)).reduce((sum, item) => sum + item.collectFeeAmount + item.payoutFeeAmount, 0) / Math.max(1, feeRows.reduce((sum, item) => sum + item.collectFeeAmount + item.payoutFeeAmount, 0)) : 0)}</td><td>{formatPercent(shownSummary.totalPct)}</td><td className="muted-cell">汇总</td></tr>
            <tr className="summary-row overall-summary-row"><td colSpan={3}>全部汇总</td><td className="num">{formatNumber(totalSummary.collectAmount)}</td><td>{pct(totalSummary.collectAmount, totalSummary.totalAmount)}</td><td className="num">{formatNumber(totalSummary.collectCount)}</td><td className="num">{formatNumber(totalSummary.payoutAmount)}</td><td>{pct(totalSummary.payoutAmount, totalSummary.totalAmount)}</td><td className="num">{formatNumber(totalSummary.payoutCount)}</td><td className="num strong-cell">{formatNumber(totalSummary.totalAmount)}</td><td className="num strong-cell">{formatNumber(totalSummary.totalCount)}</td><td>{totalSummary.collectAmount ? formatPercent(feeRows.reduce((sum, item) => sum + item.collectFeeAmount, 0) / totalSummary.collectAmount) : '-'}</td><td className="num">{formatNumber(feeRows.reduce((sum, item) => sum + item.collectFeeAmount, 0))}</td><td>{totalSummary.payoutAmount ? formatPercent(feeRows.reduce((sum, item) => sum + item.payoutFeeAmount, 0) / totalSummary.payoutAmount) : '-'}</td><td className="num">{formatNumber(feeRows.reduce((sum, item) => sum + item.payoutFeeAmount, 0))}</td><td className="num">{formatNumber(feeRows.reduce((sum, item) => sum + item.collectFeeAmount + item.payoutFeeAmount, 0))}</td><td>100.00%</td><td>100.00%</td><td className="muted-cell">汇总</td></tr>
          </tfoot>
        </table>
      </div>
      {selected && <VolumeRowsModal title={`${"date" in selected ? selected.date : ""} / ${selected.labelParts.join(" / ")}`} rows={selected.rows} onClose={() => setSelected(null)} />}
      {selectedFeeIssues && <FeeIssueRowsModal title={selectedFeeIssues.title} rows={selectedFeeIssues.rows} onClose={() => setSelectedFeeIssues(null)} />}
    </div>
  );
}

function DailyCompareTable({ title, subtitle, rows, feeRows }: { title: string; subtitle: string; rows: DailyCompareRow[]; feeRows: FeeCompareRow[] }) {
  const [selected, setSelected] = useState<DailyCompareRow | ComboSummary | null>(null);
  const [selectedFeeIssues, setSelectedFeeIssues] = useState<{ title: string; rows: FeeCompareRow[] } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const pager = usePagination(rows, true);
  const shownSummary = sumDailyCompareSummaryRows(pager.shown);
  const totalSummary = sumDailyCompareSummaryRows(rows);

  function feeForRow(row: DailyCompareRow): FeeSummary {
    // V195：日汇总主行是“日期 + 国家 + 统一三方”的总量，同一个三方下面可能同时存在 UPI / 银行卡 / 代付类型等多种类型。
    // 之前如果当前主三方被判断成单一类型，会只匹配其中一种类型，导致页面显示有费率但手续费金额为 0。
    // 主行必须合并这个三方当天所有类型的手续费；类型拆分只在展开子行里做。
    const matched = feeRows.filter((item) => item.date === row.date && item.country === row.country && item.channel === row.channel);
    const totalCollectFee = feeRows.reduce((sum, item) => sum + item.collectFeeAmount, 0);
    const totalPayoutFee = feeRows.reduce((sum, item) => sum + item.payoutFeeAmount, 0);
    return summarizeFeeRows(matched, totalCollectFee, totalPayoutFee);
  }

  function childLines(row: DailyCompareRow) {
    const grouped = aggregateCombo(row.rows, (raw) => {
      const type = normalizedDisplayChannelType(raw.country, raw.channelType || inferThirdPartyChannelType(raw.rawChannel || raw.channel, raw.country, `${raw.channel} ${raw.rawChannel}`) || "其他类型", [raw]);
      return [raw.country, raw.channel, type];
    });
    return grouped.map((child) => {
      const [country = row.country, channel = row.channel, type = "其他类型"] = child.labelParts;
      const displayType = normalizedDisplayChannelType(country, type, child.rows);
      const matched = feeRows.filter((item) => item.date === row.date && item.country === country && item.channel === channel && (!displayType || feeTypeMatches(country, displayType, item.channelType)));
      const totalCollectFee = feeRows.reduce((sum, item) => sum + item.collectFeeAmount, 0);
      const totalPayoutFee = feeRows.reduce((sum, item) => sum + item.payoutFeeAmount, 0);
      return { ...child, displayType, fee: summarizeFeeRows(matched, totalCollectFee, totalPayoutFee) };
    }).filter((child) => child.totalAmount > 0 || child.totalCount > 0).sort((a, b) => b.totalAmount - a.totalAmount || b.totalCount - a.totalCount);
  }

  return (
    <div className="panel daily-compare-panel">
      <div className="panel-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></div>
      <TablePager total={rows.length} page={pager.page} pageSize={pager.pageSize} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
      <div className="table-wrap work-table-wrap daily-compare-wrap">
        <table>
          <thead><tr><th>日期</th><th>国家</th><th>统一三方</th><th className="num">代收金额</th><th>代收占比</th><th className="num">代收笔数</th><th className="num">代付金额</th><th>代付占比</th><th className="num">代付笔数</th><th className="num">合计金额</th><th className="num">合计笔数</th><th>代收费率</th><th className="num">代收手续费</th><th>代付费率</th><th className="num">代付手续费</th><th className="num">合计手续费</th><th>手续费占比</th><th className="num">昨日代收</th><th>代收对比</th><th className="num">昨日代付</th><th>代付对比</th><th>总占比</th><th>详情</th></tr></thead>
          <tbody>{pager.shown.flatMap((row) => {
            const fee = feeForRow(row);
            const children = childLines(row);
            const isOpen = !!expanded[row.key];
            const main = <tr key={row.key} className={fee.alertRows.length ? "fee-warning-main-row" : ""}><td>{row.date}</td><td>{row.country}</td><td className="strong-cell">{row.channel}</td><td className="num">{formatNumber(row.collectAmount)}</td><td><ShareBar value={row.collectPct} /></td><td className="num">{formatNumber(row.collectCount)}</td><td className="num">{formatNumber(row.payoutAmount)}</td><td><ShareBar value={row.payoutPct} /></td><td className="num">{formatNumber(row.payoutCount)}</td><td className="num strong-cell">{formatNumber(row.totalAmount)}</td><td className="num strong-cell">{formatNumber(row.totalCount)}</td><td>{feeRateText(fee, "collect")}</td><td className="num">{feeAmountText(fee, "collect")}</td><td>{feeRateText(fee, "payout")}</td><td className="num">{feeAmountText(fee, "payout")}</td><td className="num">{feeTotalText(fee)}</td><td>{feeShareNode(fee, () => setSelectedFeeIssues({ title: `${row.date} / ${row.country} / ${row.channel}`, rows: fee.alertRows }))}</td><td className="num">{row.previousCollectAmount ? formatNumber(row.previousCollectAmount) : "-"}</td><td><ChangeBadge value={row.collectDiffPercent} /></td><td className="num">{row.previousPayoutAmount ? formatNumber(row.previousPayoutAmount) : "-"}</td><td><ChangeBadge value={row.payoutDiffPercent} /></td><td>{formatPercent(row.totalPct)}</td><td><div className="row-action-group">{children.length > 0 && <button className="mini-btn" onClick={() => setExpanded((old) => ({ ...old, [row.key]: !old[row.key] }))}>{isOpen ? "收起" : "展开"}</button>}<button className="mini-btn" onClick={() => setSelected(row)}>查看</button></div></td></tr>;
            if (!isOpen || !children.length) return [main];
            const childRows = children.map((child) => {
              const childHasCollect = sideHasValue(child.collectAmount, child.collectCount);
              const childHasPayout = sideHasValue(child.payoutAmount, child.payoutCount);
              return <tr key={`${row.key}|||child|||${child.key}`} className="volume-child-row"><td>{row.date}</td><td>{row.country}</td><td>{`↳ ${child.displayType || "-"}`}</td><td className="num">{sideNumberText(child.collectAmount, child.collectCount)}</td><td>{sideShareNode(childHasCollect, amountRatio(child.collectAmount,row.collectAmount))}</td><td className="num">{sideCountText(child.collectAmount, child.collectCount)}</td><td className="num">{sideNumberText(child.payoutAmount, child.payoutCount)}</td><td>{sideShareNode(childHasPayout, amountRatio(child.payoutAmount,row.payoutAmount))}</td><td className="num">{sideCountText(child.payoutAmount, child.payoutCount)}</td><td className="num strong-cell">{formatNumber(child.totalAmount)}</td><td className="num strong-cell">{formatNumber(child.totalCount)}</td><td>{sideFeeRateText(child.fee, "collect", child.collectAmount, child.collectCount)}</td><td className="num">{sideFeeAmountText(child.fee, "collect", child.collectAmount, child.collectCount)}</td><td>{sideFeeRateText(child.fee, "payout", child.payoutAmount, child.payoutCount)}</td><td className="num">{sideFeeAmountText(child.fee, "payout", child.payoutAmount, child.payoutCount)}</td><td className="num">{feeTotalText(child.fee)}</td><td>{feeShareNode(child.fee, () => setSelectedFeeIssues({ title: `${row.date} / ${row.country} / ${row.channel} / ${child.displayType}`, rows: child.fee.alertRows }))}</td><td className="num">-</td><td className="muted-cell">-</td><td className="num">-</td><td className="muted-cell">-</td><td>{row.totalAmount ? formatPercent(child.totalAmount / row.totalAmount) : "-"}</td><td><button className="mini-btn" onClick={() => setSelected(child)}>查看</button></td></tr>;
            });
            return [main, ...childRows];
          })}{!pager.shown.length && <tr><td colSpan={23} className="empty">暂无所有明细数据</td></tr>}</tbody>
          <tfoot>
            <tr className="summary-row page-summary-row"><td colSpan={3}>当前页汇总</td><td className="num">{formatNumber(shownSummary.collectAmount)}</td><td>{pct(shownSummary.collectAmount, shownSummary.totalAmount)}</td><td className="num">{formatNumber(shownSummary.collectCount)}</td><td className="num">{formatNumber(shownSummary.payoutAmount)}</td><td>{pct(shownSummary.payoutAmount, shownSummary.totalAmount)}</td><td className="num">{formatNumber(shownSummary.payoutCount)}</td><td className="num strong-cell">{formatNumber(shownSummary.totalAmount)}</td><td className="num strong-cell">{formatNumber(shownSummary.totalCount)}</td><td>-</td><td className="num">{formatNumber(feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.channel === item.channel)).reduce((sum, item) => sum + item.collectFeeAmount, 0))}</td><td>-</td><td className="num">{formatNumber(feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.channel === item.channel)).reduce((sum, item) => sum + item.payoutFeeAmount, 0))}</td><td className="num">{formatNumber(feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.channel === item.channel)).reduce((sum, item) => sum + item.collectFeeAmount + item.payoutFeeAmount, 0))}</td><td>{formatPercent(feeRows.reduce((sum, item) => sum + item.collectFeeAmount + item.payoutFeeAmount, 0) ? feeRows.filter((item) => pager.shown.some((row) => row.date === item.date && row.country === item.country && row.channel === item.channel)).reduce((sum, item) => sum + item.collectFeeAmount + item.payoutFeeAmount, 0) / feeRows.reduce((sum, item) => sum + item.collectFeeAmount + item.payoutFeeAmount, 0) : 0)}</td><td className="num">{shownSummary.previousCollectAmount ? formatNumber(shownSummary.previousCollectAmount) : '-'}</td><td>{diffPercentText(shownSummary.collectAmount, shownSummary.previousCollectAmount)}</td><td className="num">{shownSummary.previousPayoutAmount ? formatNumber(shownSummary.previousPayoutAmount) : '-'}</td><td>{diffPercentText(shownSummary.payoutAmount, shownSummary.previousPayoutAmount)}</td><td>{formatPercent(shownSummary.totalPct)}</td><td className="muted-cell">汇总</td></tr>
            <tr className="summary-row overall-summary-row"><td colSpan={3}>全部汇总</td><td className="num">{formatNumber(totalSummary.collectAmount)}</td><td>{pct(totalSummary.collectAmount, totalSummary.totalAmount)}</td><td className="num">{formatNumber(totalSummary.collectCount)}</td><td className="num">{formatNumber(totalSummary.payoutAmount)}</td><td>{pct(totalSummary.payoutAmount, totalSummary.totalAmount)}</td><td className="num">{formatNumber(totalSummary.payoutCount)}</td><td className="num strong-cell">{formatNumber(totalSummary.totalAmount)}</td><td className="num strong-cell">{formatNumber(totalSummary.totalCount)}</td><td>-</td><td className="num">{formatNumber(feeRows.reduce((sum, item) => sum + item.collectFeeAmount, 0))}</td><td>-</td><td className="num">{formatNumber(feeRows.reduce((sum, item) => sum + item.payoutFeeAmount, 0))}</td><td className="num">{formatNumber(feeRows.reduce((sum, item) => sum + item.collectFeeAmount + item.payoutFeeAmount, 0))}</td><td>100.00%</td><td className="num">{totalSummary.previousCollectAmount ? formatNumber(totalSummary.previousCollectAmount) : '-'}</td><td>{diffPercentText(totalSummary.collectAmount, totalSummary.previousCollectAmount)}</td><td className="num">{totalSummary.previousPayoutAmount ? formatNumber(totalSummary.previousPayoutAmount) : '-'}</td><td>{diffPercentText(totalSummary.payoutAmount, totalSummary.previousPayoutAmount)}</td><td>100.00%</td><td className="muted-cell">汇总</td></tr>
          </tfoot>
        </table>
      </div>
      {selected && <VolumeRowsModal title={`${"date" in selected ? selected.date : ""} / ${selected.labelParts.join(" / ")}`} rows={selected.rows} onClose={() => setSelected(null)} />}
      {selectedFeeIssues && <FeeIssueRowsModal title={selectedFeeIssues.title} rows={selectedFeeIssues.rows} onClose={() => setSelectedFeeIssues(null)} />}
    </div>
  );
}

function VolumeRowsModal({ title, rows, onClose }: { title: string; rows: ThirdPartyVolumeRow[]; onClose: () => void }) {
  type ModalSortKey = "date" | "country" | "platform" | "direction" | "channelType" | "channel" | "rawChannel" | "amount" | "count";
  const [modalKeyword, setModalKeyword] = useState("");
  const [modalCountry, setModalCountry] = useState("");
  const [modalPlatform, setModalPlatform] = useState("");
  const [modalDirection, setModalDirection] = useState("");
  const [modalSort, setModalSort] = useState<{ key: ModalSortKey; direction: "asc" | "desc" }>({ key: "date", direction: "asc" });

  const countryOptions = useMemo(() => sortCountries(rows.map((row) => row.country)), [rows]);
  const platformOptions = useMemo(() => uniq(rows.filter((row) => !modalCountry || row.country === modalCountry).map((row) => canonicalThirdPartyPlatform(row.country, row.platform))), [rows, modalCountry]);
  const directionOptions = useMemo(() => uniq(rows.map((row) => row.direction)), [rows]);

  const filteredRows = useMemo(() => {
    const kw = modalKeyword.trim().toLowerCase();
    return rows.filter((row) => {
      if (modalCountry && row.country !== modalCountry) return false;
      if (modalPlatform && !matchesThirdPartyPlatformSelection(row.country, row.platform, [modalPlatform])) return false;
      if (modalDirection && row.direction !== modalDirection) return false;
      if (kw && !`${row.date} ${row.country} ${row.platform} ${row.direction} ${row.channelType || ""} ${row.channel} ${row.rawChannel}`.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [rows, modalKeyword, modalCountry, modalPlatform, modalDirection]);

  const sortedRows = useMemo(() => {
    const list = [...filteredRows];
    const dir = modalSort.direction === "asc" ? 1 : -1;
    list.sort((a, b) => {
      const av = modalSort.key === "amount" || modalSort.key === "count"
        ? Number(a[modalSort.key] || 0)
        : String((a as any)[modalSort.key] || "").toLowerCase();
      const bv = modalSort.key === "amount" || modalSort.key === "count"
        ? Number(b[modalSort.key] || 0)
        : String((b as any)[modalSort.key] || "").toLowerCase();
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "zh-CN", { numeric: true, sensitivity: "base" }) * dir;
    });
    return list;
  }, [filteredRows, modalSort]);

  function toggleModalSort(key: ModalSortKey) {
    setModalSort((current) => current.key === key
      ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
      : { key, direction: key === "amount" || key === "count" ? "desc" : "asc" });
  }

  function sortMark(key: ModalSortKey) {
    if (modalSort.key !== key) return "↕";
    return modalSort.direction === "asc" ? "↑" : "↓";
  }

  const summary = sumRows(filteredRows);
  const pager = usePagination<ThirdPartyVolumeRow>(sortedRows, true);
  const amountTotal = filteredRows.reduce((sum, row) => sum + row.amount, 0);
  const countTotal = filteredRows.reduce((sum, row) => sum + row.count, 0);

  const SortTh = ({ label, sortKey, num }: { label: string; sortKey: ModalSortKey; num?: boolean }) => (
    <th className={num ? "num" : undefined}>
      <button type="button" className="modal-sort-btn" onClick={() => toggleModalSort(sortKey)}>
        {label}<span>{sortMark(sortKey)}</span>
      </button>
    </th>
  );

  return (
    <div className="modal-backdrop"><div className="detail-modal work-detail-modal volume-detail-modal volume-detail-modal-v209">
      <div className="detail-modal-header"><div><h3>{title}</h3></div><button className="modal-close-btn" type="button" onClick={onClose}>关闭</button></div>
      <div className="modal-filter-row">
        <div className="field"><label>搜索</label><input className="input" value={modalKeyword} onChange={(event) => setModalKeyword(event.target.value)} placeholder="搜索平台 / 三方 / 原始名称" /></div>
        <div className="field"><label>国家</label><select className="input" value={modalCountry} onChange={(event) => { setModalCountry(event.target.value); setModalPlatform(""); }}><option value="">全部国家</option>{countryOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
        <div className="field"><label>平台</label><select className="input" value={modalPlatform} onChange={(event) => setModalPlatform(event.target.value)}><option value="">全部平台</option>{platformOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
        <div className="field"><label>业务方向</label><select className="input" value={modalDirection} onChange={(event) => setModalDirection(event.target.value)}><option value="">全部方向</option>{directionOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
        <button className="ghost-btn" type="button" onClick={() => { setModalKeyword(""); setModalCountry(""); setModalPlatform(""); setModalDirection(""); }}>清空</button>
      </div>
      <div className="modal-summary-grid modal-summary-grid-v209"><div><span>筛选金额</span><strong>{formatNumber(summary.amount)}</strong><p>全部 {formatNumber(rows.reduce((sum, row) => sum + row.amount, 0))}</p></div><div><span>筛选笔数</span><strong>{formatNumber(summary.count)}</strong><p>全部 {formatNumber(rows.reduce((sum, row) => sum + row.count, 0))}</p></div><div><span>代收</span><strong>{formatNumber(summary.collectAmount)}</strong><p>{pct(summary.collectAmount, summary.amount)} · {formatNumber(summary.collectCount)} 笔</p></div><div><span>代付</span><strong>{formatNumber(summary.payoutAmount)}</strong><p>{pct(summary.payoutAmount, summary.amount)} · {formatNumber(summary.payoutCount)} 笔</p></div></div>
      <TablePager total={sortedRows.length} page={pager.page} pageSize={pager.pageSize} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
      <div className="table-wrap detail-table-wrap"><table><thead><tr>
        <SortTh label="日期" sortKey="date" />
        <SortTh label="国家" sortKey="country" />
        <SortTh label="平台" sortKey="platform" />
        <SortTh label="业务方向" sortKey="direction" />
        <SortTh label="钱包/通道类型" sortKey="channelType" />
        <SortTh label="统一三方" sortKey="channel" />
        <SortTh label="原始名称" sortKey="rawChannel" />
        <SortTh label="金额" sortKey="amount" num />
        <th>金额占比</th>
        <SortTh label="笔数" sortKey="count" num />
        <th>笔数占比</th>
      </tr></thead><tbody>{pager.shown.map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.country}</td><td>{row.platform}</td><td>{row.direction}</td><td>{row.channelType || "其他类型"}</td><td>{row.channel}</td><td>{row.rawChannel}</td><td className="num">{formatNumber(row.amount)}</td><td><ShareBar value={amountTotal ? row.amount / amountTotal : 0} /></td><td className="num">{formatNumber(row.count)}</td><td><ShareBar value={countTotal ? row.count / countTotal : 0} /></td></tr>)}{!pager.shown.length && <tr><td colSpan={11} className="empty">暂无明细</td></tr>}</tbody></table></div>
    </div></div>
  );
}

function CountryFeeAnomalyPanel({ country, rows, allRows, dateRangeLabel }: { country: string; rows: FeeCompareRow[]; allRows: FeeCompareRow[]; dateRangeLabel: string }) {
  const [period, setPeriod] = useState<FeeAnomalyPeriod>("day");
  const [selected, setSelected] = useState<FeeCompareRow | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const periodRows = useMemo<FeeCompareRow[]>(() => {
    if (period === "day") return rows;
    const map = new Map<string, FeeCompareRow>();
    for (const row of allRows) {
      if (row.country !== country) continue;
      const key = `${periodKeyFor(row.date || "", period)}|||${row.country}|||${row.platform}|||${row.channel}|||${row.channelType}`;
      const current = map.get(key);
      if (!current) {
        map.set(key, { ...row, date: periodKeyFor(row.date || "", period), collectShare: 0, payoutShare: 0, totalShare: 0 });
      } else {
        current.collectAmount += row.collectAmount;
        current.collectCount += row.collectCount;
        current.payoutAmount += row.payoutAmount;
        current.payoutCount += row.payoutCount;
        current.totalAmount += row.totalAmount;
        current.totalCount += row.totalCount;
        current.collectFeeAmount += row.collectFeeAmount;
        current.payoutFeeAmount += row.payoutFeeAmount;
        current.estimatedFee += row.estimatedFee;
        if (row.level === "danger") current.level = "danger";
        else if (row.level === "warning" && current.level === "normal") current.level = "warning";
        else if (row.level === "missing" && current.level === "normal") current.level = "missing";
        if (row.advice && !current.advice.includes(row.advice)) current.advice = current.advice === "正常观察" ? row.advice : `${current.advice}；${row.advice}`;
      }
    }
    const combined = Array.from(map.values());
    const totals = new Map<string, { collect: number; payout: number; total: number }>();
    for (const row of combined) {
      const scopeKey = `${row.date || "累计"}|||${row.country}`;
      const current = totals.get(scopeKey) || { collect: 0, payout: 0, total: 0 };
      current.collect += row.collectAmount;
      current.payout += row.payoutAmount;
      current.total += row.totalAmount;
      totals.set(scopeKey, current);
    }
    const rebuilt = combined.map((row) => {
      const total = totals.get(`${row.date || "累计"}|||${row.country}`) || { collect: 0, payout: 0, total: 0 };
      return {
        ...row,
        collectShare: total.collect ? row.collectAmount / total.collect : 0,
        payoutShare: total.payout ? row.payoutAmount / total.payout : 0,
        totalShare: total.total ? row.totalAmount / total.total : 0,
        effectiveTotalFeeRate: row.totalAmount ? row.estimatedFee / row.totalAmount : 0
      };
    });
    return feeWarningRows(rebuilt).sort((a, b) => b.estimatedFee - a.estimatedFee || b.totalAmount - a.totalAmount);
  }, [period, rows, allRows, country]);

  type GroupedAnomaly = {
    key: string;
    date: string;
    country: string;
    channel: string;
    channelType: string;
    collectAmount: number;
    collectCount: number;
    payoutAmount: number;
    payoutCount: number;
    totalAmount: number;
    totalCount: number;
    collectFeeAmount: number;
    payoutFeeAmount: number;
    estimatedFee: number;
    collectShare: number;
    payoutShare: number;
    totalShare: number;
    level: FeeCompareRow["level"];
    advice: string;
    rows: FeeCompareRow[];
  };

  const groupedRows = useMemo<GroupedAnomaly[]>(() => {
    const map = new Map<string, GroupedAnomaly>();
    for (const row of periodRows) {
      const key = `${row.date || "累计"}|||${row.country}|||${row.channel}|||${row.channelType || "其他类型"}`;
      const current = map.get(key) || {
        key,
        date: row.date || "累计",
        country: row.country,
        channel: row.channel,
        channelType: row.channelType || "其他类型",
        collectAmount: 0,
        collectCount: 0,
        payoutAmount: 0,
        payoutCount: 0,
        totalAmount: 0,
        totalCount: 0,
        collectFeeAmount: 0,
        payoutFeeAmount: 0,
        estimatedFee: 0,
        collectShare: 0,
        payoutShare: 0,
        totalShare: 0,
        level: "normal" as FeeCompareRow["level"],
        advice: "",
        rows: []
      };
      current.collectAmount += row.collectAmount;
      current.collectCount += row.collectCount;
      current.payoutAmount += row.payoutAmount;
      current.payoutCount += row.payoutCount;
      current.totalAmount += row.totalAmount;
      current.totalCount += row.totalCount;
      current.collectFeeAmount += row.collectFeeAmount;
      current.payoutFeeAmount += row.payoutFeeAmount;
      current.estimatedFee += row.estimatedFee;
      if (row.level === "danger") current.level = "danger";
      else if (row.level === "warning" && current.level !== "danger") current.level = "warning";
      else if (row.level === "missing" && current.level === "normal") current.level = "missing";
      if (row.advice && !current.advice.includes(row.advice)) current.advice = current.advice ? `${current.advice}；${row.advice}` : row.advice;
      current.rows.push(row);
      map.set(key, current);
    }
    const totals = new Map<string, { collect: number; payout: number; total: number }>();
    for (const row of map.values()) {
      const scope = `${row.date}|||${row.country}`;
      const current = totals.get(scope) || { collect: 0, payout: 0, total: 0 };
      current.collect += row.collectAmount;
      current.payout += row.payoutAmount;
      current.total += row.totalAmount;
      totals.set(scope, current);
    }
    return Array.from(map.values()).map((row) => {
      const total = totals.get(`${row.date}|||${row.country}`) || { collect: 0, payout: 0, total: 0 };
      return {
        ...row,
        collectShare: total.collect ? row.collectAmount / total.collect : 0,
        payoutShare: total.payout ? row.payoutAmount / total.payout : 0,
        totalShare: total.total ? row.totalAmount / total.total : 0,
        advice: Array.from(new Set(row.advice.split("；").filter(Boolean))).join("；") || "正常观察",
        rows: row.rows.sort((a, b) => b.estimatedFee - a.estimatedFee || b.totalAmount - a.totalAmount)
      };
    }).sort((a, b) => {
      const score = (row: GroupedAnomaly) => row.level === "danger" ? 3 : row.level === "warning" ? 2 : row.level === "missing" ? 1 : 0;
      return score(b) - score(a) || b.estimatedFee - a.estimatedFee || b.totalAmount - a.totalAmount;
    });
  }, [periodRows]);

  const pager = usePagination<GroupedAnomaly>(groupedRows, true);
  return (
    <div className="panel country-fee-anomaly-panel">
      <div className="panel-head">
        <div><h2>{countryPaneLabel(country)} 异常提醒</h2><p>按「统一三方 + 钱包/通道类型」汇总，异常判断看合计手续费和总有效费率。当前日期范围：{dateRangeLabel}</p></div>
        <div className="period-switch"><button className={cls(period === "day" && "active")} onClick={() => setPeriod("day")}>日</button><button className={cls(period === "week" && "active")} onClick={() => setPeriod("week")}>周</button><button className={cls(period === "month" && "active")} onClick={() => setPeriod("month")}>月</button></div>
      </div>
      <PageStatStrip items={[["异常三方", groupedRows.length], ["预估费用", formatNumber(groupedRows.reduce((sum, row) => sum + row.estimatedFee, 0))], ["代收金额", formatNumber(groupedRows.reduce((sum, row) => sum + row.collectAmount, 0))], ["代付金额", formatNumber(groupedRows.reduce((sum, row) => sum + row.payoutAmount, 0))]]} />
      <TablePager total={groupedRows.length} page={pager.page} pageSize={pager.pageSize} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
      <div className="table-wrap work-table-wrap fee-anomaly-table"><table><thead><tr><th>{period === "day" ? "日期" : period === "week" ? "周起始" : "月份"}</th><th>国家</th><th>统一三方</th><th>钱包/通道</th><th className="num">代收金额</th><th>代收占比</th><th className="num">代付金额</th><th>代付占比</th><th className="num">合计金额</th><th>总占比</th><th className="num">合计手续费</th><th>总有效费率</th><th>手续费占比</th><th>判断</th><th>详情</th></tr></thead><tbody>{pager.shown.flatMap((row) => {
        const isOpen = !!expanded[row.key];
        const feeBase = groupedRows.reduce((sum, item) => sum + item.estimatedFee, 0);
        const mainEffectiveRate = row.totalAmount ? row.estimatedFee / row.totalAmount : 0;
        const main = <tr key={row.key} className={row.level !== "normal" ? "warning-row" : ""}><td>{row.date}</td><td>{row.country}</td><td className="strong-cell">{row.channel}</td><td>{row.channelType || "其他类型"}</td><td className="num">{formatNumber(row.collectAmount)}</td><td><ShareBar value={row.collectShare} /></td><td className="num">{formatNumber(row.payoutAmount)}</td><td><ShareBar value={row.payoutShare} /></td><td className="num strong-cell">{formatNumber(row.totalAmount)}</td><td><ShareBar value={row.totalShare} /></td><td className="num strong-cell">{formatNumber(row.estimatedFee)}</td><td>{mainEffectiveRate ? formatPercent(mainEffectiveRate) : "-"}</td><td>{feeBase ? formatPercent(row.estimatedFee / feeBase) : "0.00%"}</td><td>{row.advice}</td><td><div className="row-action-group"><button className="mini-btn" onClick={() => setExpanded((old) => ({ ...old, [row.key]: !old[row.key] }))}>{isOpen ? "收起" : "展开"}</button></div></td></tr>;
        if (!isOpen) return [main];
        const children = row.rows.map((child) => <tr key={`${row.key}|||${child.key}`} className="volume-child-row"><td>{child.date || row.date}</td><td>{child.country}</td><td>{`↳ ${child.platform}`}</td><td>{child.channelType || "其他类型"}</td><td className="num">{formatNumber(child.collectAmount)}</td><td><ShareBar value={amountRatio(child.collectAmount,row.collectAmount)} /></td><td className="num">{formatNumber(child.payoutAmount)}</td><td><ShareBar value={amountRatio(child.payoutAmount,row.payoutAmount)} /></td><td className="num">{formatNumber(child.totalAmount)}</td><td><ShareBar value={row.totalAmount ? child.totalAmount / row.totalAmount : 0} /></td><td className="num">{formatNumber(child.estimatedFee)}</td><td>{child.effectiveTotalFeeRate ? formatPercent(child.effectiveTotalFeeRate) : "-"}</td><td>{row.estimatedFee ? formatPercent(child.estimatedFee / row.estimatedFee) : "0.00%"}</td><td>{child.advice}</td><td><button className="mini-btn" onClick={() => setSelected(child)}>查看</button></td></tr>);
        return [main, ...children];
      })}{!pager.shown.length && <tr><td colSpan={15} className="empty">当前国家暂无明显异常。</td></tr>}</tbody></table></div>
      {selected && <FeeDetailModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function comboThirdPartyName(row: ComboSummary): string {
  const parts = row.labelParts.filter(Boolean);
  if (parts.length >= 3) return parts[2];
  if (parts.length >= 2) return parts[1];
  return parts[0] || "未知三方";
}

type ThirdPartyStructureRow = {
  name: string;
  collectAmount: number;
  collectCount: number;
  payoutAmount: number;
  payoutCount: number;
  totalAmount: number;
  totalCount: number;
};

function buildThirdPartyStructureRows(rows: ThirdPartyVolumeRow[]): ThirdPartyStructureRow[] {
  const map = new Map<string, ThirdPartyStructureRow>();
  for (const row of rows) {
    const name = row.channel || canonicalThirdPartyName(row.rawChannel || "未知三方", row.country);
    const current = map.get(name) || { name, collectAmount: 0, collectCount: 0, payoutAmount: 0, payoutCount: 0, totalAmount: 0, totalCount: 0 };
    if (row.direction === "代收") {
      current.collectAmount += row.amount;
      current.collectCount += row.count;
    } else if (row.direction === "代付") {
      current.payoutAmount += row.amount;
      current.payoutCount += row.count;
    }
    current.totalAmount = current.collectAmount + current.payoutAmount;
    current.totalCount = current.collectCount + current.payoutCount;
    map.set(name, current);
  }
  return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount || b.totalCount - a.totalCount || a.name.localeCompare(b.name, "zh-CN", { numeric: true }));
}


type FeeStructureRow = {
  name: string;
  fee: number;
  amount: number;
  count: number;
};

function buildFeeStructureRows(rows: FeeCompareRow[]): FeeStructureRow[] {
  const map = new Map<string, FeeStructureRow>();
  for (const row of rows) {
    const name = row.channel || "未知三方";
    const current = map.get(name) || { name, fee: 0, amount: 0, count: 0 };
    current.fee += row.estimatedFee;
    current.amount += row.totalAmount;
    current.count += row.totalCount;
    map.set(name, current);
  }
  return Array.from(map.values()).filter((row) => row.fee > 0).sort((a, b) => b.fee - a.fee || b.amount - a.amount);
}

function FeeStructureMetricList({ rows }: { rows: FeeCompareRow[] }) {
  const feeRows = buildFeeStructureRows(rows);
  const total = feeRows.reduce((sum, row) => sum + row.fee, 0);
  const shown = feeRows.slice(0, 10);
  return (
    <div className="third-party-structure-box fee-structure-box">
      <h4>手续费占比</h4>
      <div className="third-party-structure-list">
        {shown.map((row, index) => (
          <div className="third-party-structure-row" key={`fee-${row.name}`}>
            <div className="rank-no">{index + 1}</div>
            <div className="third-party-structure-name">
              <strong>{row.name}</strong>
              <span>手续费 {formatNumber(row.fee)} · 金额 {formatNumber(row.amount)} · 笔数 {formatNumber(row.count)}</span>
            </div>
            <ShareBar value={total ? row.fee / total : 0} />
          </div>
        ))}
        {!shown.length && <div className="empty">暂无手续费占比</div>}
      </div>
    </div>
  );
}

function StructureMetricList({
  title,
  rows,
  total,
  valueOf,
  subValueOf,
  valueLabel,
  subLabel
}: {
  title: string;
  rows: ThirdPartyStructureRow[];
  total: number;
  valueOf: (row: ThirdPartyStructureRow) => number;
  subValueOf: (row: ThirdPartyStructureRow) => number;
  valueLabel: string;
  subLabel: string;
}) {
  const shown = rows.filter((row) => valueOf(row) > 0).sort((a, b) => valueOf(b) - valueOf(a) || subValueOf(b) - subValueOf(a)).slice(0, 10);
  return (
    <div className="third-party-structure-box">
      <h4>{title}</h4>
      <div className="third-party-structure-list">
        {shown.map((row, index) => {
          const value = valueOf(row);
          const share = total ? value / total : 0;
          return (
            <div className="third-party-structure-row" key={`${title}-${row.name}`}>
              <div className="rank-no">{index + 1}</div>
              <div className="third-party-structure-name">
                <strong>{row.name}</strong>
                <span>{valueLabel} {formatNumber(value)} · {subLabel} {formatNumber(subValueOf(row))}</span>
              </div>
              <ShareBar value={share} />
            </div>
          );
        })}
        {!shown.length && <div className="empty">暂无{title}</div>}
      </div>
    </div>
  );
}

function ThirdPartyStructureCard({ title, subtitle, rows, summary, feeRows = [] }: { title: string; subtitle: string; rows: ThirdPartyVolumeRow[]; summary: ReturnType<typeof sumRows>; feeRows?: FeeCompareRow[] }) {
  const structureRows = buildThirdPartyStructureRows(rows);
  return (
    <div className="panel third-party-structure-panel">
      <div className="panel-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></div>
      <div className="third-party-structure-summary">
        <div><span>主三方</span><strong>{formatNumber(structureRows.length)}</strong></div>
        <div><span>代收金额</span><strong>{formatNumber(summary.collectAmount)}</strong></div>
        <div><span>代付金额</span><strong>{formatNumber(summary.payoutAmount)}</strong></div>
        <div><span>合计金额</span><strong>{formatNumber(summary.amount)}</strong></div>
      </div>
      <div className="third-party-structure-grid">
        <StructureMetricList title="代收金额占比" rows={structureRows} total={summary.collectAmount} valueOf={(row) => row.collectAmount} subValueOf={(row) => row.collectCount} valueLabel="金额" subLabel="笔数" />
        <StructureMetricList title="代付金额占比" rows={structureRows} total={summary.payoutAmount} valueOf={(row) => row.payoutAmount} subValueOf={(row) => row.payoutCount} valueLabel="金额" subLabel="笔数" />
        <StructureMetricList title="代收笔数占比" rows={structureRows} total={summary.collectCount} valueOf={(row) => row.collectCount} subValueOf={(row) => row.collectAmount} valueLabel="笔数" subLabel="金额" />
        <StructureMetricList title="代付笔数占比" rows={structureRows} total={summary.payoutCount} valueOf={(row) => row.payoutCount} subValueOf={(row) => row.payoutAmount} valueLabel="笔数" subLabel="金额" />
        <FeeStructureMetricList rows={feeRows} />
      </div>
    </div>
  );
}

function SplitDirectionTopCard({ collectRows, payoutRows }: { collectRows: ComboSummary[]; payoutRows: ComboSummary[] }) {
  return (
    <div className="panel split-direction-panel">
      <div className="panel-head"><div><h2>代收 / 代付 TOP</h2><p>分开看代收、代付，避免混在一起看起来很乱。</p></div></div>
      <div className="split-direction-grid">
        <div>
          <h4>代收 TOP</h4>
          <div className="mini-list compact-mini-list">{collectRows.map((row, index) => <div className="rank-item" key={`c-${row.key}`}><div className="rank-no">{index + 1}</div><div><div className="rank-name">{row.labelParts[1] || row.labelParts[0]}</div><div className="rank-sub">笔数 {formatNumber(row.collectCount)} · 占比 {formatPercent(row.collectPct)}</div></div><div className="rank-value">{formatNumber(row.collectAmount)}</div></div>)}{!collectRows.length && <div className="empty">暂无代收</div>}</div>
        </div>
        <div>
          <h4>代付 TOP</h4>
          <div className="mini-list compact-mini-list">{payoutRows.map((row, index) => <div className="rank-item" key={`p-${row.key}`}><div className="rank-no">{index + 1}</div><div><div className="rank-name">{row.labelParts[1] || row.labelParts[0]}</div><div className="rank-sub">笔数 {formatNumber(row.payoutCount)} · 占比 {formatPercent(row.payoutPct)}</div></div><div className="rank-value">{formatNumber(row.payoutAmount)}</div></div>)}{!payoutRows.length && <div className="empty">暂无代付</div>}</div>
        </div>
      </div>
    </div>
  );
}

function OverviewPage({ summary, monthlyRows, countryRows, platformRows, aliasRows, warnings }: { summary: ReturnType<typeof sumRows>; monthlyRows: ComboSummary[]; countryRows: ComboSummary[]; platformRows: ComboSummary[]; aliasRows: Array<{ name: string; aliases: string[] }>; warnings: string[] }) {
  return (
    <>
      <section className="chart-grid">
        <VolumeShareCard summary={summary} />
        <TopListCard title="平台跑量 TOP" subtitle="按国家 / 平台 / 统一三方汇总，显示代收和代付量。" rows={platformRows.slice(0, 8)} />
      </section>
      <section className="chart-grid">
        <MonthlyTable title="国家三方合计 TOP" subtitle="按国家 + 统一三方汇总代收、代付、总量和占比。" rows={monthlyRows.slice(0, 40)} columns={["国家", "统一三方"]} compact />
        <MonthlyTable title="国家总量 TOP" subtitle="先按国家分区查看，再进入合计/平台明细看各平台。" rows={countryRows.slice(0, 40)} columns={["国家"]} compact />
      </section>
      <section className="chart-grid">
        <AliasCheckPanel aliasRows={aliasRows.slice(0, 18)} />
        <TextAnomalyPanel rows={warnings.slice(0, 18)} compact />
      </section>
    </>
  );
}

function MonthlyPage({ rows, summary, feeRows, allRows }: { rows: ComboSummary[]; summary: ReturnType<typeof sumRows>; feeRows: FeeCompareRow[]; allRows: ThirdPartyVolumeRow[] }) {
  const feeStatItems = buildFeeStatItems(feeRows);
  return (
    <>
      <PageStatStrip items={[["国家数量", groupCombosByCountry(rows).length], ["主三方", rows.length], ["代收金额", formatNumber(summary.collectAmount)], ["代收笔数", formatNumber(summary.collectCount)], ["代付金额", formatNumber(summary.payoutAmount)], ["代付笔数", formatNumber(summary.payoutCount)], ...feeStatItems]} />
      <CountryMonthlySections title="合计" subtitle="按国家分区，再看每个国家下面的统一三方；同三方通道已合并，并联动三方费率。点“展开”可直接看各类型总量（跨平台合并）。" rows={rows} columns={["国家", "统一三方"]} feeRows={feeRows} />
      <ThirdPartyStructureCard title="合计三方结构" subtitle="放在页面底部，只按当前筛选条件计算，详细区分代收 / 代付金额、笔数和手续费占比。" rows={allRows} summary={summary} feeRows={feeRows} />
    </>
  );
}

function PlatformPage({ rows, summary, feeRows }: { rows: ComboSummary[]; summary: ReturnType<typeof sumRows>; feeRows: FeeCompareRow[] }) {
  const feeStatItems = buildFeeStatItems(feeRows);
  return (
    <>
      <PageStatStrip items={[["国家数量", groupCombosByCountry(rows).length], ["平台三方组合", rows.length], ["代收金额", formatNumber(summary.collectAmount)], ["代收笔数", formatNumber(summary.collectCount)], ["代付金额", formatNumber(summary.payoutAmount)], ["代付笔数", formatNumber(summary.payoutCount)], ...feeStatItems]} />
      <CountryMonthlySections title="平台明细" subtitle="按国家分区，再看国家 > 平台 > 统一三方，显示代收/代付费率、手续费和费用占比。" rows={rows} columns={["国家", "平台", "统一三方"]} feeRows={feeRows} />
    </>
  );
}

function DailyPage({ rows, summary, feeRows }: { rows: DailyCompareRow[]; summary: ReturnType<typeof sumRows>; feeRows: FeeCompareRow[] }) {
  const groups = sortCountries(rows.map((row) => row.country)).map((country) => ({ country, rows: rows.filter((row) => row.country === country) }));
  const feeStatItems = buildFeeStatItems(feeRows);
  return (
    <>
      <PageStatStrip items={[["国家数量", groups.length], ["日期/主三方", rows.length], ["代收金额", formatNumber(summary.collectAmount)], ["代收笔数", formatNumber(summary.collectCount)], ["代付金额", formatNumber(summary.payoutAmount)], ["代付笔数", formatNumber(summary.payoutCount)], ...feeStatItems]} />
      <div className="country-section-stack compact-country-section-stack">
        {groups.map((group) => (
          <section className="country-section-card" key={group.country}>
            <CountrySectionHeader country={group.country} amount={sumRows(group.rows.flatMap((row) => row.rows)).amount} count={sumRows(group.rows.flatMap((row) => row.rows)).count} extra={`日期/主三方 ${uniq(group.rows.map((row) => row.date)).length} / ${uniq(group.rows.map((row) => row.channel)).length}`} />
            <DailyCompareTable title={`${group.country} 所有明细`} subtitle="当前国家内按 日期 > 主三方 汇总；展开后看各类型总量。" rows={group.rows} feeRows={feeRows.filter((row) => row.country === group.country)} />
          </section>
        ))}
        {!groups.length && <div className="panel"><div className="empty">暂无国家分区数据</div></div>}
      </div>
      <ThirdPartyStructureCard title="三方结构" subtitle="放在页面底部，只按当前筛选条件计算，详细区分代收 / 代付金额、笔数和手续费占比。" rows={rows.flatMap((row) => row.rows)} summary={summary} feeRows={feeRows} />
    </>
  );
}

function FeeOverview({ dailyRows, dailyWarnings, platformRows }: { dailyRows: FeeCompareRow[]; dailyWarnings: FeeCompareRow[]; platformRows: FeeCompareRow[] }) {
  const totalFee = dailyRows.reduce((sum, row) => sum + row.estimatedFee, 0);
  const missing = dailyRows.filter((row) => row.level === "missing").length;
  const danger = dailyRows.filter((row) => row.level === "danger").length;
  const lowRateLowVolume = dailyRows.filter((row) => row.advice.includes("总费率低但跑量少")).length;
  return (
    <>
      <PageStatStrip items={[["每日高费率高跑量", danger], ["低费率低跑量", lowRateLowVolume], ["未匹配费率", missing], ["预估费用", formatNumber(totalFee)]]} />
      <section className="chart-grid">
        <CountryFeeSections rows={dailyWarnings.slice(0, 80)} title="每日费率风险 TOP" subtitle="按国家分区，看每天各平台高费率高量、低费率低量。" showDate compact />
        <CountryFeeSections rows={platformRows.slice(0, 80)} title="平台累计费用 TOP" subtitle="按国家分区，看各国家平台累计预估费用。" compact />
      </section>
    </>
  );
}

function PageStatStrip({ items }: { items: PageStatItem[] }) {
  return (
    <section className="page-stat-strip">
      {items.map((item) => {
        const normalized = Array.isArray(item) ? { label: item[0], value: item[1], tone: "default" as PageStatTone } : item;
        const hasDelta = typeof normalized.delta === "number";
        const direction = hasDelta ? (normalized.delta! > 0 ? "up" : normalized.delta! < 0 ? "down" : "flat") : "";
        const Tag=normalized.onClick?"button":"div";
        return (
          <Tag key={normalized.label} type={normalized.onClick?"button":undefined} onClick={normalized.onClick} aria-haspopup={normalized.onClick?"dialog":undefined} aria-label={normalized.onClick?`${normalized.label} ${normalized.value}，点击查看平台查询情况`:undefined} title={normalized.onClick?normalized.helper:undefined} data-label={normalized.label} data-tone={normalized.tone || "default"} className={`page-stat-card${normalized.onClick?" page-stat-action":""}`}>
            <span>{normalized.label}</span>
            <strong>{normalized.value}</strong>
            {hasDelta ? (
              <p className={`page-stat-compare ${direction}`}>
                <span>{normalized.compareLabel || "较昨日"}</span>
                <b>{signedNumberText(normalized.delta!)} <em>{signedPercentText(normalized.deltaPercent ?? null)}</em></b>
              </p>
            ) : normalized.helper ? <p className="page-stat-helper">{normalized.helper}</p> : null}
            {hasDelta&&normalized.onClick&&normalized.helper&&<p className="page-stat-helper">{normalized.helper}</p>}
          </Tag>
        );
      })}
    </section>
  );
}

function FeeStatStrip({ items }: { items: Array<[string, string | number]> }) {
  return (
    <section className="page-stat-strip fee-stat-strip">
      {items.map(([label, value]) => <div key={label} className="page-stat-card fee-stat-card"><span>{label}</span><strong>{value}</strong></div>)}
    </section>
  );
}

function VolumeShareCard({ summary }: { summary: ReturnType<typeof sumRows> }) {
  const collectAmountPct = summary.amount ? summary.collectAmount / summary.amount : 0;
  const payoutAmountPct = summary.amount ? summary.payoutAmount / summary.amount : 0;
  const collectCountPct = summary.count ? summary.collectCount / summary.count : 0;
  const payoutCountPct = summary.count ? summary.payoutCount / summary.count : 0;
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>代收 / 代付结构</h2><p>当前筛选范围内金额与笔数占比，避免只看一个圆环不够直观。</p></div></div>
      <div className="donut-chart-wrap volume-donut-wrap">
        <div className="donut-chart" style={{ background: `conic-gradient(#2563eb 0 ${collectAmountPct * 360}deg, #f97316 ${collectAmountPct * 360}deg 360deg)` }}><div className="donut-center"><strong>{formatPercent(collectAmountPct)}</strong><span>代收金额占比</span></div></div>
        <div className="legend-list">
          <div className="legend-row"><span className="legend-dot blue-dot" /><span>代收金额</span><b>{formatNumber(summary.collectAmount)}</b></div>
          <div className="legend-row"><span className="legend-dot orange-dot" /><span>代付金额</span><b>{formatNumber(summary.payoutAmount)}</b></div>
          <div className="legend-row"><span className="legend-dot gray-dot" /><span>合计金额</span><b>{formatNumber(summary.amount)}</b></div>
        </div>
      </div>
      <div className="ratio-detail-list">
        <div className="ratio-detail-item">
          <div className="ratio-detail-head"><strong>金额结构</strong><span>代收 {formatPercent(collectAmountPct)} · 代付 {formatPercent(payoutAmountPct)}</span></div>
          <div className="dual-progress"><i style={{ width: `${collectAmountPct * 100}%` }} /><em style={{ width: `${payoutAmountPct * 100}%` }} /></div>
          <div className="ratio-detail-meta"><span>代收金额 {formatNumber(summary.collectAmount)}</span><span>代付金额 {formatNumber(summary.payoutAmount)}</span></div>
        </div>
        <div className="ratio-detail-item">
          <div className="ratio-detail-head"><strong>笔数结构</strong><span>代收 {formatPercent(collectCountPct)} · 代付 {formatPercent(payoutCountPct)}</span></div>
          <div className="dual-progress"><i style={{ width: `${collectCountPct * 100}%` }} /><em style={{ width: `${payoutCountPct * 100}%` }} /></div>
          <div className="ratio-detail-meta"><span>代收笔数 {formatNumber(summary.collectCount)}</span><span>代付笔数 {formatNumber(summary.payoutCount)}</span></div>
        </div>
      </div>
    </div>
  );
}

function TopListCard({ title, subtitle, rows }: { title: string; subtitle: string; rows: ComboSummary[] }) {
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></div>
      <div className="mini-list">
        {rows.map((row, index) => <div className="rank-item" key={row.key}><div className="rank-no">{index + 1}</div><div><div className="rank-name">{row.labelParts.join(" / ")}</div><div className="rank-sub">代收 {formatNumber(row.collectAmount)} · 代付 {formatNumber(row.payoutAmount)} · 占比 {formatPercent(row.totalPct)}</div></div><div className="rank-value">{formatNumber(row.totalAmount)}</div></div>)}
        {!rows.length && <div className="empty">暂无数据</div>}
      </div>
    </div>
  );
}

function TablePager({ total, page, pageSize, onPageChange, onPageSizeChange }: { total: number; page: number; pageSize: PageSize; onPageChange: (page: number) => void; onPageSizeChange: (pageSize: PageSize) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total ? (safePage - 1) * pageSize + 1 : 0;
  const end = Math.min(total, safePage * pageSize);
  return (
    <div className="table-pager-row">
      <span>显示 {start} - {end} / 共 {formatNumber(total)} 行</span>
      <div className="pager-controls">
        <label>每页</label>
        <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value) as PageSize)}>
          <option value={20}>20</option>
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={200}>200</option>
        </select>
        <button disabled={safePage <= 1} onClick={() => onPageChange(1)}>首页</button>
        <button disabled={safePage <= 1} onClick={() => onPageChange(safePage - 1)}>上一页</button>
        <strong>{safePage} / {totalPages}</strong>
        <button disabled={safePage >= totalPages} onClick={() => onPageChange(safePage + 1)}>下一页</button>
        <button disabled={safePage >= totalPages} onClick={() => onPageChange(totalPages)}>末页</button>
      </div>
    </div>
  );
}

function usePagination<T>(rows: T[], enabled = true) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const shown = enabled ? rows.slice((safePage - 1) * pageSize, safePage * pageSize) : rows;
  function changePageSize(size: PageSize) {
    setPageSize(size);
    setPage(1);
  }
  return { page: safePage, pageSize, shown, setPage, setPageSize: changePageSize };
}

function CountrySectionHeader({ country, amount, count, extra }: { country: string; amount: number; count?: number; extra?: string }) {
  return (
    <div className="country-section-header">
      <div>
        <span className="country-section-label">国家分区</span>
        <h3>{country}</h3>
      </div>
      <div className="country-section-metrics">
        <span>金额 <b>{formatNumber(amount)}</b></span>
        {count !== undefined && <span>笔数 <b>{formatNumber(count)}</b></span>}
        {extra && <span>{extra}</span>}
      </div>
    </div>
  );
}

function CountryMonthlySections({ title, subtitle, rows, columns, feeRows = [] }: { title: string; subtitle: string; rows: ComboSummary[]; columns: string[]; feeRows?: FeeCompareRow[] }) {
  const groups = groupCombosByCountry(rows);
  return (
    <div className="country-section-stack compact-country-section-stack">
      {groups.map((group) => (
        <section className="country-section-card" key={group.country}>
          <CountrySectionHeader country={group.country} amount={group.summary.amount} count={group.summary.count} extra={`平台/三方 ${uniq(group.rows.map((row) => row.labelParts[1] || row.labelParts[2] || "")).length} 个`} />
          <MonthlyTable title={`${group.country} 明细`} subtitle="本国家内的数据，按金额从高到低排序；费率和手续费来自三方费率表。" rows={group.rows} columns={columns} feeRows={feeRows.filter((row) => row.country === group.country)} paginated />
        </section>
      ))}
      {!groups.length && <div className="panel"><div className="empty">暂无国家分区数据</div></div>}
    </div>
  );
}

function CountryDirectionSections({ title, subtitle, rows, columns }: { title: string; subtitle: string; rows: DirectionSummary[]; columns: string[] }) {
  const groups = groupDirectionsByCountry(rows);
  return (
    <div className="country-section-stack">
      <div className="panel country-section-intro">
        <div className="panel-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></div>
      </div>
      {groups.map((group) => (
        <section className="country-section-card" key={group.country}>
          <CountrySectionHeader country={group.country} amount={group.amount} count={group.count} extra={`明细 ${formatNumber(group.rows.length)} 行`} />
          <DirectionTable title={`${group.country} 每日明细`} subtitle="本国家内的数据，按金额从高到低排序。" rows={group.rows} columns={columns} paginated />
        </section>
      ))}
      {!groups.length && <div className="panel"><div className="empty">暂无国家分区数据</div></div>}
    </div>
  );
}

function CountryFeeSections({ rows, title, subtitle, showDate, compact }: { rows: FeeCompareRow[]; title: string; subtitle: string; showDate?: boolean; compact?: boolean }) {
  const [selectedCountry, setSelectedCountry] = useState<{ country: string; rows: FeeCompareRow[] } | null>(null);
  const groups = groupFeesByCountry(rows);
  const shownGroups = compact ? groups.slice(0, 6) : groups;
  return (
    <div className="country-section-stack fee-country-stack">
      <div className="panel country-section-intro">
        <div className="panel-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></div>
      </div>
      {shownGroups.map((group) => {
        const previewRows = group.rows.slice(0, 12);
        return (
          <section className="country-section-card" key={group.country}>
            <CountrySectionHeader country={group.country} amount={group.amount} extra={`预估费用 ${formatNumber(group.fee)} · 异常 ${group.warnings} 条`} />
            <FeeCompareTable rows={previewRows} compact title={`${group.country} 异常提醒 TOP ${previewRows.length}`} showDate={showDate} />
            {group.rows.length > previewRows.length && (
              <div className="table-note view-more-note">
                这里只展示 TOP {previewRows.length} / 共 {group.rows.length} 条，
                <button className="mini-btn" type="button" onClick={() => setSelectedCountry({ country: group.country, rows: group.rows })}>查看更多</button>
              </div>
            )}
          </section>
        );
      })}
      {!shownGroups.length && <div className="panel"><div className="empty">暂无费率对比数据</div></div>}
      {selectedCountry && <FeeCountryRowsModal country={selectedCountry.country} rows={selectedCountry.rows} showDate={showDate} onClose={() => setSelectedCountry(null)} />}
    </div>
  );
}

function FeeCountryRowsModal({ country, rows, showDate, onClose }: { country: string; rows: FeeCompareRow[]; showDate?: boolean; onClose: () => void }) {
  return (
    <div className="modal-backdrop"><div className="detail-modal work-detail-modal volume-detail-modal fee-country-modal">
      <div className="detail-modal-header"><div><h3>{country} 异常提醒全部明细</h3><p>按当前筛选条件展示这个国家的全部异常，可继续点每行“查看”看费率和手续费细节。</p></div><button className="modal-close-btn" type="button" onClick={onClose}>关闭</button></div>
      <FeeCompareTable rows={rows} title={`${country} 全部异常提醒`} showDate={showDate} />
    </div></div>
  );
}

function FeeIssueRowsModal({ title, rows, onClose }: { title: string; rows: FeeCompareRow[]; onClose: () => void }) {
  return (
    <div className="modal-backdrop"><div className="detail-modal work-detail-modal volume-detail-modal fee-country-modal">
      <div className="detail-modal-header"><div><h3>{title}</h3><p>这里列出费率高但跑量多、或便宜费率跑量少的具体平台 / 三方 / 钱包通道，方便你直接对比。</p></div><button className="modal-close-btn" type="button" onClick={onClose}>关闭</button></div>
      <FeeCompareTable rows={rows} title="手续费占比异常来源" showDate />
    </div></div>
  );
}

function feeShareNode(summary: FeeSummary, onOpen: () => void) {
  const text = summary.totalFeeShare ? formatPercent(summary.totalFeeShare) : "-";
  if (!summary.alertRows.length) return <span>{text}</span>;
  return <button type="button" className="fee-share-alert-btn" onClick={onOpen}>{text}</button>;
}

function MonthlyTable({ title, subtitle, rows, columns, columnIndexes, stickyFirstColumn, feeRows = [], paginated, compact, collectionSuccess, withdrawPending, workOrderDeposit, withdrawActual, withdrawSuccess, orderRateHint, onView }: { title: string; subtitle: string; rows: ComboSummary[]; columns: string[]; columnIndexes?: number[]; stickyFirstColumn?: boolean; feeRows?: FeeCompareRow[]; paginated?: boolean; compact?: boolean; collectionSuccess?: CollectionSuccessView; withdrawPending?: WithdrawPendingView; workOrderDeposit?: WorkOrderDepositView; withdrawActual?: WithdrawActualView; withdrawSuccess?: CollectionSuccessView; orderRateHint?: string; onView?: (row: ComboSummary) => void }) {
  const [selected, setSelected] = useState<ComboSummary | null>(null);
  const [selectedFeeIssues, setSelectedFeeIssues] = useState<{ title: string; rows: FeeCompareRow[] } | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [sort, setSort] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "totalAmount", direction: "desc" });
  const feeMode: FeeSummaryMode = columns.includes("月份") ? "monthlyPeriod" : columns.includes("平台") ? "platform" : "monthly";
  const feeMap = useMemo(() => buildFeeSummaryMap(feeRows, feeMode), [feeRows, feeMode]);
  const showFeeColumns = feeRows.length > 0;
  const hasPlatformColumn = columns.includes("平台");
  const dimensionIndexes = columnIndexes || columns.map((_, index) => index);
  const totalCollectFee = feeRows.reduce((sum, row) => sum + row.collectFeeAmount, 0);
  const totalPayoutFee = feeRows.reduce((sum, row) => sum + row.payoutFeeAmount, 0);

  const successKeys = (items: ComboSummary[]) => items.map(item => collectionSuccessProviderKey(item.labelParts[0], item.labelParts[1]));
  // 存款、提款工单各展示提交/成功的金额与笔数，以及按笔数计算的成功占比。
  const workOrderColumnCount = workOrderDeposit ? 10 : 0;
  const showCollectRate = Boolean(collectionSuccess || orderRateHint);
  const columnCount = columns.length + (showFeeColumns ? 16 : 10) + (showCollectRate ? 1 : 0) + 1 + (withdrawPending ? 2 : 0) + workOrderColumnCount + (withdrawActual ? 2 : 0);
  const depositKeys = (items: ComboSummary[]) => items.map((item) => {
    const country = item.labelParts[0] || "";
    return workOrderDepositProviderKey(country, item.labelParts[1] || "");
  });
  const issueNumber = (metric: ReturnType<WorkOrderDepositView["compare"]>["current"] | undefined, kind: "deposit" | "withdraw", field: "submittedAmount" | "submittedCount" | "successAmount" | "successCount") => {
    if (!metric || metric.state === "missing" || metric.state === "unavailable") return null;
    if (kind === "deposit") {
      if (field === "submittedAmount") return metric.submittedAmount;
      if (field === "submittedCount") return metric.submittedCount;
      if (field === "successAmount") return metric.successAmount;
      return metric.successCount;
    }
    if (field === "submittedAmount") return metric.withdrawNotReceivedAmount;
    if (field === "submittedCount") return metric.withdrawNotReceivedCount;
    if (field === "successAmount") return metric.withdrawSuccessAmount;
    return metric.withdrawSuccessCount;
  };
  const issueValue = (metric: ReturnType<WorkOrderDepositView["compare"]>["current"] | undefined, kind: "deposit" | "withdraw", field: "submittedAmount" | "submittedCount" | "successAmount" | "successCount") => {
    const value = issueNumber(metric, kind, field);
    return value == null ? "—" : formatNumber(value);
  };
  const issueRate = (metric: ReturnType<WorkOrderDepositView["compare"]>["current"] | undefined, kind: "deposit" | "withdraw") => {
    const submitted = issueNumber(metric, kind, "submittedCount");
    const success = issueNumber(metric, kind, "successCount");
    if (submitted == null || success == null || submitted <= 0) return "—";
    return formatPercent(success / submitted);
  };

  const sortedRows = useMemo(() => {
    const value = (row: ComboSummary): string | number | null => {
      if (sort.key.startsWith("dimension:")) return row.labelParts[Number(sort.key.slice(10))] || "";
      const providerKeys = successKeys([row]);
      const fee = feeMap.get(comboFeeKey(row, columns)) || emptyFeeSummary();
      switch (sort.key) {
        case "collectAmount": return row.collectAmount;
        case "collectCount": return row.collectCount;
        case "collectionSuccessRate": return collectionSuccess?.compare(providerKeys).current.rate ?? null;
        case "payoutSuccessRate": return withdrawSuccess?.compare(providerKeys).current.rate ?? null;
        case "collectPct": return row.collectPct;
        case "payoutAmount": return row.payoutAmount;
        case "payoutCount": return row.payoutCount;
        case "withdrawActualAmount": case "withdrawActualFee": {
          const metric = withdrawActual?.compare(providerKeys).current;
          return metric && (metric.state === "complete" || metric.state === "zero")
            ? (sort.key === "withdrawActualAmount" ? metric.actualAmount : metric.feeAmount) : null;
        }
        case "withdrawPendingAmount": case "withdrawPendingCount": {
          const metric = withdrawPending?.compare(providerKeys).current;
          return metric && (metric.state === "complete" || metric.state === "zero")
            ? (sort.key === "withdrawPendingAmount" ? metric.amount : metric.count) : null;
        }
        case "depositSubmittedAmount": return issueNumber(workOrderDeposit?.compare(depositKeys([row])).current, "deposit", "submittedAmount");
        case "depositSubmittedCount": return issueNumber(workOrderDeposit?.compare(depositKeys([row])).current, "deposit", "submittedCount");
        case "depositSuccessAmount": return issueNumber(workOrderDeposit?.compare(depositKeys([row])).current, "deposit", "successAmount");
        case "depositSuccessCount": return issueNumber(workOrderDeposit?.compare(depositKeys([row])).current, "deposit", "successCount");
        case "depositSuccessRate": {
          const metric = workOrderDeposit?.compare(depositKeys([row])).current;
          const submitted = issueNumber(metric, "deposit", "submittedCount"), success = issueNumber(metric, "deposit", "successCount");
          return submitted != null && success != null && submitted > 0 ? success / submitted : null;
        }
        case "withdrawNotReceivedAmount": return issueNumber(workOrderDeposit?.compare(depositKeys([row])).current, "withdraw", "submittedAmount");
        case "withdrawNotReceivedCount": return issueNumber(workOrderDeposit?.compare(depositKeys([row])).current, "withdraw", "submittedCount");
        case "withdrawSuccessAmount": return issueNumber(workOrderDeposit?.compare(depositKeys([row])).current, "withdraw", "successAmount");
        case "withdrawSuccessCount": return issueNumber(workOrderDeposit?.compare(depositKeys([row])).current, "withdraw", "successCount");
        case "withdrawSuccessRate": {
          const metric = workOrderDeposit?.compare(depositKeys([row])).current;
          const submitted = issueNumber(metric, "withdraw", "submittedCount"), success = issueNumber(metric, "withdraw", "successCount");
          return submitted != null && success != null && submitted > 0 ? success / submitted : null;
        }
        case "payoutPct": return row.payoutPct;
        case "totalAmount": return row.totalAmount;
        case "totalCount": return row.totalCount;
        case "collectFeeRate": return fee.collectHasFee ? fee.collectRate : null;
        case "collectFee": return fee.collectHasFee ? fee.collectFee : null;
        case "payoutFeeRate": return fee.payoutHasFee ? fee.payoutRate : null;
        case "payoutFee": return fee.payoutHasFee ? fee.payoutFee : null;
        case "estimatedFee": return fee.collectHasFee || fee.payoutHasFee ? fee.estimatedFee : null;
        case "feeShare": return fee.collectHasFee || fee.payoutHasFee ? fee.totalFeeShare : null;
        case "totalPct": return row.totalPct;
        default: return null;
      }
    };
    const direction = sort.direction === "asc" ? 1 : -1;
    return rows.map((row, index) => {
      const raw = value(row);
      // Keep unavailable money/rates at the end in either direction; zero is
      // still a real value. Never let NaN make the comparator inconsistent.
      return { row, index, value: raw == null || (typeof raw === "number" && !Number.isFinite(raw)) || raw === "" ? null : raw };
    }).sort((a, b) => {
      if (a.value == null && b.value == null) return a.index - b.index;
      if (a.value == null) return 1;
      if (b.value == null) return -1;
      const compared = typeof a.value === "number" && typeof b.value === "number"
        ? a.value - b.value
        : String(a.value).localeCompare(String(b.value), "zh-CN", { numeric: true, sensitivity: "base" });
      return compared ? compared * direction : a.index - b.index;
    }).map(item => item.row);
  }, [rows, sort, columns, feeMap, collectionSuccess, withdrawActual, withdrawPending, workOrderDeposit, withdrawSuccess]);
  const pager = usePagination(sortedRows, !!paginated);
  const shown = paginated ? pager.shown : sortedRows;
  const shownSummary = sumComboSummaryRows(shown);
  const totalSummary = sumComboSummaryRows(rows);
  const shownFeeKeys = new Set(shown.map(row=>comboFeeKey(row,columns)));
  const shownFees = summarizeFeeRows(feeRows.filter(row=>shownFeeKeys.has(feeSummaryKey(row,feeMode))));
  const allFees = summarizeFeeRows(feeRows);

  const toggleSort = (key: string, numeric = false) => setSort(current => current?.key === key
    ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
    : { key, direction: numeric ? "desc" : "asc" });
  const SortTh = ({ label, groupLabel, sortKey, numeric, className = "", title }: { label: string; groupLabel?: string; sortKey: string; numeric?: boolean; className?: string; title?: string }) => {
    const active = sort.key === sortKey;
    if(groupLabel&&workOrderDeposit?.basisHint){groupLabel+="（日）";title=`${workOrderDeposit.basisHint} ${title||""}`;}
    return <th className={`${className} sortable-th ${numeric ? "num" : ""} ${active ? "active" : ""}`} title={title} aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}>
      <button className="th-sort-btn" type="button" onClick={() => toggleSort(sortKey, numeric)}>{groupLabel ? <span className="workorder-heading-label"><small>{groupLabel}</small><span>{label}</span></span> : <span>{label}</span>}<span className="sort-arrow" aria-hidden="true">{active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}</span></button>
    </th>;
  };

  function feeForChild(country: string, platform: string, channel: string, type: string): FeeSummary {
    const canonical = canonicalThirdPartyName(channel, country);
    const normalizedType = normalizeRateCategory(country, type);
    const matched = feeRows.filter((row) => {
      if (row.country !== country) return false;
      if (row.channel !== canonical) return false;
      if (platform && row.platform !== platform) return false;
      if (normalizedType && !feeTypeMatches(country, normalizedType, row.channelType)) return false;
      return true;
    });
    return summarizeFeeRows(matched, totalCollectFee, totalPayoutFee);
  }

  function childLines(row: ComboSummary) {
    const parentCountry = row.labelParts[0] || "";
    const parentChannel = hasPlatformColumn ? (row.labelParts[2] || "") : (row.labelParts[1] || "");
    const grouped = aggregateCombo(row.rows, (raw) => {
      const type = normalizedDisplayChannelType(raw.country, raw.channelType || inferThirdPartyChannelType(raw.rawChannel || raw.channel, raw.country, `${raw.channel} ${raw.rawChannel}`) || "其他类型", [raw]);
      return hasPlatformColumn
        ? [raw.country, raw.platform, canonicalThirdPartyName(raw.channel, raw.country), type]
        : [raw.country, canonicalThirdPartyName(raw.channel, raw.country), type];
    });
    return grouped.map((child) => {
      if (hasPlatformColumn) {
        const [country = parentCountry, platform = "", channel = parentChannel, type = ""] = child.labelParts;
        const displayParts = [country, platform, `↳ ${normalizedDisplayChannelType(country, type, child.rows)}`];
        return { ...child, displayParts, fee: feeForChild(country, platform, channel, normalizedDisplayChannelType(country, type, child.rows)) };
      }
      const [country = parentCountry, channel = parentChannel, type = ""] = child.labelParts;
      const displayParts = [country, `↳ ${normalizedDisplayChannelType(country, type, child.rows)}`];
      return { ...child, displayParts, fee: feeForChild(country, "", channel, normalizedDisplayChannelType(country, type, child.rows)) };
    }).filter((child) => child.totalAmount > 0 || child.totalCount > 0).sort((a, b) => b.totalAmount - a.totalAmount || b.totalCount - a.totalCount);
  }

  return (
    <div className="panel">
      {(title||subtitle)&&<div className="panel-head"><div>{title&&<h2>{title}</h2>}{subtitle ? <p>{subtitle}</p> : null}</div></div>}
      <div className={cls("table-wrap", "work-table-wrap", "volume-summary-table-wrap", stickyFirstColumn && "sticky-first-dimension") }>
        <table>
          <thead><tr>
            {columns.map((column, index) => <SortTh key={column} label={column} sortKey={`dimension:${dimensionIndexes[index] ?? index}`} />)}
            <SortTh label="代收金额" sortKey="collectAmount" numeric className="num" />
            <SortTh label="代收笔数" sortKey="collectCount" numeric className="num" />
            {showCollectRate && <SortTh label="代收成功率" sortKey="collectionSuccessRate" numeric className="num collection-success-heading" title={orderRateHint||"按提交日期：成功笔数 ÷ 提交笔数；与前一期比较使用百分点。"} />}
            <SortTh label="代收占比" sortKey="collectPct" numeric />
            <SortTh label="代付金额" sortKey="payoutAmount" numeric className="num" />
            <SortTh label="代付笔数" sortKey="payoutCount" numeric className="num" />
            <SortTh label="代付成功率" sortKey="payoutSuccessRate" numeric className="num" title="创建时间口径：成功提现笔数 ÷ 提现订单总笔数。没有完整分母时不计算。" />
            {withdrawActual && <><SortTh label="实际到账金额" sortKey="withdrawActualAmount" numeric className="num withdraw-actual-heading" title="提现订单中的实际到账金额（real_amount）。来源没有完整覆盖时显示 —。" /><SortTh label="提现手续费" sortKey="withdrawActualFee" numeric className="num withdraw-actual-heading" title="提现订单中的实际手续费（fee）。来源没有完整覆盖时显示 —。" /></>}
            {withdrawPending && <><SortTh label="代付中金额" sortKey="withdrawPendingAmount" numeric className="num withdraw-pending-heading" title={orderRateHint?"所选创建时间内，目前状态仍为已提交的提现订单金额。":"各国家当地时间 00:00 采集前 10 个完整自然日内，提现状态严格等于“已提交”的申请金额。"} /><SortTh label="代付中笔数" sortKey="withdrawPendingCount" numeric className="num withdraw-pending-heading" title={orderRateHint?"所选创建时间内，目前状态仍为已提交的提现订单笔数。":"各国家当地时间 00:00 采集前 10 个完整自然日内，提现状态严格等于“已提交”的提交笔数。"} /></>}
            {workOrderDeposit && <>
              <SortTh groupLabel="存款未到账" label="提交金额" sortKey="depositSubmittedAmount" numeric className="num workorder-metric-heading workorder-deposit-heading" title="按工单真实三方名称归类的存款未到账提交金额。" />
              <SortTh groupLabel="存款未到账" label="提交笔数" sortKey="depositSubmittedCount" numeric className="num workorder-metric-heading workorder-deposit-heading" title="按工单真实三方名称归类的存款未到账提交笔数。" />
              <SortTh groupLabel="存款未到账" label="成功金额" sortKey="depositSuccessAmount" numeric className="num workorder-metric-heading workorder-deposit-heading" title="存款未到账工单中状态为“已处理”的金额。" />
              <SortTh groupLabel="存款未到账" label="成功笔数" sortKey="depositSuccessCount" numeric className="num workorder-metric-heading workorder-deposit-heading" title="存款未到账工单中状态为“已处理”的笔数。" />
              <SortTh groupLabel="存款未到账" label="成功占比" sortKey="depositSuccessRate" numeric className="num workorder-metric-heading workorder-deposit-heading workorder-success-heading" title="成功笔数 ÷ 提交笔数。" />
              <SortTh groupLabel="提款未到账" label="提交金额" sortKey="withdrawNotReceivedAmount" numeric className="num workorder-metric-heading workorder-withdraw-heading" title="按工单真实三方名称归类的提款未到账提交金额。" />
              <SortTh groupLabel="提款未到账" label="提交笔数" sortKey="withdrawNotReceivedCount" numeric className="num workorder-metric-heading workorder-withdraw-heading" title="按工单真实三方名称归类的提款未到账提交笔数。" />
              <SortTh groupLabel="提款未到账" label="成功金额" sortKey="withdrawSuccessAmount" numeric className="num workorder-metric-heading workorder-withdraw-heading" title="提款未到账工单中状态为“已处理”的金额。" />
              <SortTh groupLabel="提款未到账" label="成功笔数" sortKey="withdrawSuccessCount" numeric className="num workorder-metric-heading workorder-withdraw-heading" title="提款未到账工单中状态为“已处理”的笔数。" />
              <SortTh groupLabel="提款未到账" label="成功占比" sortKey="withdrawSuccessRate" numeric className="num workorder-metric-heading workorder-withdraw-heading workorder-success-heading" title="成功笔数 ÷ 提交笔数。" />
            </>}
            <SortTh label="代付占比" sortKey="payoutPct" numeric />
            <SortTh label="合计金额" sortKey="totalAmount" numeric className="num" />
            <SortTh label="合计笔数" sortKey="totalCount" numeric className="num" />
            {showFeeColumns && <><SortTh label="代收费率" sortKey="collectFeeRate" numeric /><SortTh label="代收手续费" sortKey="collectFee" numeric className="num" /><SortTh label="代付费率" sortKey="payoutFeeRate" numeric /><SortTh label="代付手续费" sortKey="payoutFee" numeric className="num" /><SortTh label="合计手续费" sortKey="estimatedFee" numeric className="num" /><SortTh label="手续费占比" sortKey="feeShare" numeric /></>}
            <SortTh label="总占比" sortKey="totalPct" numeric />
            <th>详情</th>
          </tr></thead>
          <tbody>{shown.flatMap((row) => {
            const fee = feeMap.get(comboFeeKey(row, columns)) || emptyFeeSummary();
            const children = childLines(row);
            const success = collectionSuccess?.compare(successKeys([row]));
            const pending = withdrawPending?.compare(successKeys([row])).current;
            const deposit = workOrderDeposit?.compare(depositKeys([row])).current;
            const actual = withdrawActual?.compare(successKeys([row])).current;
            const canExpand = children.length > 0 || Boolean(success?.platforms.length);
            const isOpen = !!expanded[row.key];
            const main = <tr key={row.key} className={fee.alertRows.length ? "fee-warning-main-row" : ""}>{columns.map((_, index) => <td key={index}>{row.labelParts[dimensionIndexes[index] ?? index] || "-"}</td>)}<td className="num">{formatNumber(row.collectAmount)}</td><td className="num">{formatNumber(row.collectCount)}</td>{showCollectRate && <td>{orderRateHint ? <OrderSuccessCell value={success?.current} hint={orderRateHint}/> : success ? <CollectionSuccessCell value={success} /> : "—"}</td>}<td><ShareBar value={row.collectPct} /></td><td className="num">{formatNumber(row.payoutAmount)}</td><td className="num">{formatNumber(row.payoutCount)}</td><td><OrderSuccessCell value={withdrawSuccess?.compare(successKeys([row])).current} hint={orderRateHint}/></td>{withdrawActual && <><td className="num withdraw-actual-cell"><WithdrawActualCell metric={actual} kind="actual" /></td><td className="num withdraw-actual-cell"><WithdrawActualCell metric={actual} kind="fee" /></td></>}{withdrawPending && <><td className="num"><WithdrawPendingCell metric={pending} kind="amount" /></td><td className="num"><WithdrawPendingCell metric={pending} kind="count" /></td></>}{workOrderDeposit && <WorkOrderIssuesCells metric={deposit} formatValue={issueValue} formatRate={issueRate} />}<td><ShareBar value={row.payoutPct} /></td><td className="num strong-cell">{formatNumber(row.totalAmount)}</td><td className="num strong-cell">{formatNumber(row.totalCount)}</td>{showFeeColumns && <><td>{feeRateText(fee, "collect")}</td><td className="num">{feeAmountText(fee, "collect")}</td><td>{feeRateText(fee, "payout")}</td><td className="num">{feeAmountText(fee, "payout")}</td><td className="num">{feeTotalText(fee)}</td><td>{feeShareNode(fee, () => setSelectedFeeIssues({ title: row.labelParts.join(" / "), rows: fee.alertRows }))}</td></>}<td>{formatPercent(row.totalPct)}</td><td><div className="row-action-group">{canExpand && <button className="mini-btn" onClick={() => setExpanded((old) => ({ ...old, [row.key]: !old[row.key] }))}>{isOpen ? "收起" : "展开"}</button>}<button className="mini-btn" onClick={() => onView ? onView(row) : setSelected(row)}>查看</button></div></td></tr>;
            if (!isOpen || !canExpand) return [main];
            const childRows = children.map((child) => {
              const childHasCollect = sideHasValue(child.collectAmount, child.collectCount);
              const childHasPayout = sideHasValue(child.payoutAmount, child.payoutCount);
              return <tr key={`${row.key}|||child|||${child.key}`} className="volume-child-row">{columns.map((_, index) => <td key={index}>{child.displayParts[dimensionIndexes[index] ?? index] || "-"}</td>)}<td className="num">{sideNumberText(child.collectAmount, child.collectCount)}</td><td className="num">{sideCountText(child.collectAmount, child.collectCount)}</td>{showCollectRate && <td>{orderRateHint ? <OrderSuccessCell value={collectionSuccess?.compare(successKeys([row]), [child.labelParts[child.labelParts.length - 1]]).current} hint={orderRateHint}/> : collectionSuccess ? <CollectionSuccessCell value={collectionSuccess.compare(successKeys([row]), [child.labelParts[child.labelParts.length - 1]])} /> : "—"}</td>}<td>{sideShareNode(childHasCollect, amountRatio(child.collectAmount,row.collectAmount))}</td><td className="num">{sideNumberText(child.payoutAmount, child.payoutCount)}</td><td className="num">{sideCountText(child.payoutAmount, child.payoutCount)}</td><td><OrderSuccessCell value={withdrawSuccess?.compare(successKeys([row]), [child.labelParts[child.labelParts.length - 1]]).current} hint={orderRateHint}/></td>{withdrawActual && <><td className="num muted-cell">-</td><td className="num muted-cell">-</td></>}{withdrawPending && <><td className="num muted-cell">-</td><td className="num muted-cell">-</td></>}{workOrderDeposit && <WorkOrderIssuesEmptyCells />}<td>{sideShareNode(childHasPayout, amountRatio(child.payoutAmount,row.payoutAmount))}</td><td className="num strong-cell">{formatNumber(child.totalAmount)}</td><td className="num strong-cell">{formatNumber(child.totalCount)}</td>{showFeeColumns && <><td>{sideFeeRateText(child.fee, "collect", child.collectAmount, child.collectCount)}</td><td className="num">{sideFeeAmountText(child.fee, "collect", child.collectAmount, child.collectCount)}</td><td>{sideFeeRateText(child.fee, "payout", child.payoutAmount, child.payoutCount)}</td><td className="num">{sideFeeAmountText(child.fee, "payout", child.payoutAmount, child.payoutCount)}</td><td className="num">{feeTotalText(child.fee)}</td><td>{feeShareNode(child.fee, () => setSelectedFeeIssues({ title: `${row.labelParts.join(" / ")} / ${child.displayParts.join(" / ")}`, rows: child.fee.alertRows }))}</td></>}<td>{row.totalAmount ? formatPercent(child.totalAmount / row.totalAmount) : "-"}</td><td className="muted-cell">子通道</td></tr>;
            });
            return [main, ...childRows, ...(success?.platforms.length ? [<tr key={`${row.key}:success-platforms`} className="volume-child-row"><td colSpan={columnCount}><strong>代收成功率：</strong><CollectionSuccessBreakdown value={success} /></td></tr>] : [])];
          })}{!shown.length && <tr><td colSpan={columnCount} className="empty">暂无数据</td></tr>}</tbody>
          <tfoot>
            <tr className="summary-row page-summary-row">{columns.length > 1 ? <td colSpan={columns.length}>当前页汇总</td> : <><td>当前页汇总</td>{columns.slice(1).map((column) => <td key={`page-summary-${column}`}>-</td>)}</>}<td className="num">{formatNumber(shownSummary.collectAmount)}</td><td className="num">{formatNumber(shownSummary.collectCount)}</td>{showCollectRate && <td>{orderRateHint ? <OrderSuccessCell value={collectionSuccess?.compare(successKeys(shown)).current} hint={orderRateHint}/> : collectionSuccess ? <CollectionSuccessCell value={collectionSuccess.compare(successKeys(shown))} /> : "—"}</td>}<td>{pct(shownSummary.collectAmount, shownSummary.totalAmount)}</td><td className="num">{formatNumber(shownSummary.payoutAmount)}</td><td className="num">{formatNumber(shownSummary.payoutCount)}</td><td><OrderSuccessCell value={withdrawSuccess?.compare(successKeys(shown)).current} hint={orderRateHint}/></td>{withdrawActual && <><td className="num"><WithdrawActualCell metric={withdrawActual.compare(successKeys(shown)).current} kind="actual" /></td><td className="num"><WithdrawActualCell metric={withdrawActual.compare(successKeys(shown)).current} kind="fee" /></td></>}{withdrawPending && <><td className="num"><WithdrawPendingCell metric={withdrawPending.compare(successKeys(shown)).current} kind="amount" /></td><td className="num"><WithdrawPendingCell metric={withdrawPending.compare(successKeys(shown)).current} kind="count" /></td></>}{workOrderDeposit && <WorkOrderIssuesCells metric={workOrderDeposit.compare(depositKeys(shown)).current} formatValue={issueValue} formatRate={issueRate} />}<td>{pct(shownSummary.payoutAmount, shownSummary.totalAmount)}</td><td className="num strong-cell">{formatNumber(shownSummary.totalAmount)}</td><td className="num strong-cell">{formatNumber(shownSummary.totalCount)}</td>{showFeeColumns && <><td>-</td><td className="num">{formatNumber(shownFees.collectFee)}</td><td>-</td><td className="num">{formatNumber(shownFees.payoutFee)}</td><td className="num">{formatNumber(shownFees.estimatedFee)}</td><td>{formatPercent(amountRatio(shownFees.estimatedFee,allFees.estimatedFee))}</td></>}<td>{formatPercent(shownSummary.totalPct)}</td><td className="muted-cell">汇总</td></tr>
            <tr className="summary-row overall-summary-row">{columns.length > 1 ? <td colSpan={columns.length}>全部汇总</td> : <><td>全部汇总</td>{columns.slice(1).map((column) => <td key={`all-summary-${column}`}>-</td>)}</>}<td className="num">{formatNumber(totalSummary.collectAmount)}</td><td className="num">{formatNumber(totalSummary.collectCount)}</td>{showCollectRate && <td>{orderRateHint ? <OrderSuccessCell value={collectionSuccess?.compare(successKeys(rows)).current} hint={orderRateHint}/> : collectionSuccess ? <CollectionSuccessCell value={collectionSuccess.compare(successKeys(rows))} /> : "—"}</td>}<td>{pct(totalSummary.collectAmount, totalSummary.totalAmount)}</td><td className="num">{formatNumber(totalSummary.payoutAmount)}</td><td className="num">{formatNumber(totalSummary.payoutCount)}</td><td><OrderSuccessCell value={withdrawSuccess?.compare(successKeys(rows)).current} hint={orderRateHint}/></td>{withdrawActual && <><td className="num"><WithdrawActualCell metric={withdrawActual.compare(successKeys(rows)).current} kind="actual" /></td><td className="num"><WithdrawActualCell metric={withdrawActual.compare(successKeys(rows)).current} kind="fee" /></td></>}{withdrawPending && <><td className="num"><WithdrawPendingCell metric={withdrawPending.compare(successKeys(rows)).current} kind="amount" /></td><td className="num"><WithdrawPendingCell metric={withdrawPending.compare(successKeys(rows)).current} kind="count" /></td></>}{workOrderDeposit && <WorkOrderIssuesCells metric={workOrderDeposit.compare(depositKeys(rows)).current} formatValue={issueValue} formatRate={issueRate} />}<td>{pct(totalSummary.payoutAmount, totalSummary.totalAmount)}</td><td className="num strong-cell">{formatNumber(totalSummary.totalAmount)}</td><td className="num strong-cell">{formatNumber(totalSummary.totalCount)}</td>{showFeeColumns && <><td>-</td><td className="num">{formatNumber(allFees.collectFee)}</td><td>-</td><td className="num">{formatNumber(allFees.payoutFee)}</td><td className="num">{formatNumber(allFees.estimatedFee)}</td><td>{Number.isFinite(allFees.estimatedFee) ? "100.00%" : "—"}</td></>}<td>{Number.isFinite(totalSummary.totalAmount) ? "100.00%" : "—"}</td><td className="muted-cell">汇总</td></tr>
          </tfoot>
        </table>
      </div>
      {paginated && <TablePager total={rows.length} page={pager.page} pageSize={pager.pageSize} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />}
      {compact && rows.length > shown.length && <div className="table-note">这里只展示 TOP {shown.length}，更多请进入对应明细页。</div>}
      {selected && <VolumeRowsModal title={selected.labelParts.join(" / ")} rows={selected.rows} onClose={() => setSelected(null)} />}
      {selectedFeeIssues && <FeeIssueRowsModal title={selectedFeeIssues.title} rows={selectedFeeIssues.rows} onClose={() => setSelectedFeeIssues(null)} />}
    </div>
  );
}

function ShareBar({ value }: { value: number }) {
  if (!Number.isFinite(value)) return <span className="muted-cell">—</span>;
  return <div className="share-bar"><span>{formatPercent(value)}</span><i style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} /></div>;
}

type WorkOrderIssueMetric = ReturnType<WorkOrderDepositView["compare"]>["current"];
type WorkOrderIssueField = "submittedAmount" | "submittedCount" | "successAmount" | "successCount";
type WorkOrderIssueFormatter = (metric: WorkOrderIssueMetric | undefined, kind: "deposit" | "withdraw", field: WorkOrderIssueField) => string;
type WorkOrderIssueRateFormatter = (metric: WorkOrderIssueMetric | undefined, kind: "deposit" | "withdraw") => string;

function WorkOrderIssuesCells({ metric, formatValue, formatRate }: { metric?: WorkOrderIssueMetric; formatValue: WorkOrderIssueFormatter; formatRate: WorkOrderIssueRateFormatter }) {
  const signal = (kind: "deposit" | "withdraw") => {
    if (!metric || metric.state === "missing" || metric.state === "unavailable") return { tone: "neutral" as const, title: "" };
    const submitted = kind === "deposit" ? metric.submittedCount : metric.withdrawNotReceivedCount;
    const success = kind === "deposit" ? metric.successCount : metric.withdrawSuccessCount;
    const tone = workOrderSuccessTone(submitted, success);
    const rate = submitted > 0 ? success / submitted : null;
    const scope = kind === "deposit" ? "存款未到账" : "提款未到账";
    const title = submitted > 0
      ? `${scope}成功占比：${formatNumber(success)} / ${formatNumber(submitted)}（${formatPercent(rate || 0)}）${tone === "danger" ? "，低于 30%。" : "。"}`
      : "";
    return { tone, title };
  };
  const depositSignal = signal("deposit");
  const withdrawSignal = signal("withdraw");
  const signalClass = (tone: ReturnType<typeof workOrderSuccessTone>) => tone === "neutral" ? "" : ` workorder-success-signal is-${tone}`;
  return <>
    <td className="num workorder-deposit-cell">{formatValue(metric, "deposit", "submittedAmount")}</td>
    <td className="num workorder-deposit-cell">{formatValue(metric, "deposit", "submittedCount")}</td>
    <td className="num workorder-deposit-cell">{formatValue(metric, "deposit", "successAmount")}</td>
    <td className="num workorder-deposit-cell">{formatValue(metric, "deposit", "successCount")}</td>
    <td className={`num workorder-deposit-cell workorder-success-rate-cell${signalClass(depositSignal.tone)}`} title={depositSignal.title}>{formatRate(metric, "deposit")}</td>
    <td className="num workorder-withdraw-cell">{formatValue(metric, "withdraw", "submittedAmount")}</td>
    <td className="num workorder-withdraw-cell">{formatValue(metric, "withdraw", "submittedCount")}</td>
    <td className="num workorder-withdraw-cell">{formatValue(metric, "withdraw", "successAmount")}</td>
    <td className="num workorder-withdraw-cell">{formatValue(metric, "withdraw", "successCount")}</td>
    <td className={`num workorder-withdraw-cell workorder-success-rate-cell${signalClass(withdrawSignal.tone)}`} title={withdrawSignal.title}>{formatRate(metric, "withdraw")}</td>
  </>;
}

function WorkOrderIssuesEmptyCells() {
  return <>{Array.from({ length: 10 }, (_, index) => <td className="num muted-cell" key={`workorder-empty-${index}`}>-</td>)}</>;
}

function WithdrawPendingCell({ metric, kind }: { metric: { amount: number; count: number; state: string } | undefined; kind: "amount" | "count" }) {
  const state = metric?.state;
  const ready = state === "complete" || state === "zero";
  const value = kind === "amount" ? metric?.amount : metric?.count;
  return <span className={`withdraw-pending-value ${ready ? "is-ready" : "is-pending"}`} title="状态严格等于“已提交”；按各国家当地时间 00:00 采集前 10 个完整自然日">{ready ? formatNumber(value) : "—"}</span>;
}

function WithdrawActualCell({ metric, kind }: { metric: { actualAmount: number; feeAmount: number; state: string } | undefined; kind: "actual" | "fee" }) {
  const ready = metric?.state === "complete" || metric?.state === "zero";
  const value = kind === "actual" ? metric?.actualAmount : metric?.feeAmount;
  const label = kind === "actual" ? "实际到账金额" : "提现手续费";
  return <span className={`withdraw-actual-value ${ready ? "is-ready" : "is-pending"}`} title={`${label}来自已入库订单的安全汇总；来源覆盖不完整时不显示 0。`}>{ready ? formatNumber(value) : "—"}</span>;
}

function DirectionTable({ title, subtitle, rows, columns, paginated }: { title: string; subtitle: string; rows: DirectionSummary[]; columns: string[]; paginated?: boolean }) {
  const pager = usePagination(rows, !!paginated);
  const shown = paginated ? pager.shown : rows;
  const shownSummary = sumDirectionSummaryRows(shown);
  const totalSummary = sumDirectionSummaryRows(rows);
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>{title}</h2>{subtitle ? <p>{subtitle}</p> : null}</div></div>
      {paginated && <TablePager total={rows.length} page={pager.page} pageSize={pager.pageSize} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />}
      <div className="table-wrap work-table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}<th className="num">金额</th><th className="num">笔数</th></tr></thead><tbody>{shown.map((row) => <tr key={row.key}>{columns.map((_, index) => <td key={index}>{row.parts[index] || "-"}</td>)}<td className="num">{formatNumber(row.amount)}</td><td className="num">{formatNumber(row.count)}</td></tr>)}{!shown.length && <tr><td colSpan={columns.length + 2} className="empty">暂无数据</td></tr>}</tbody><tfoot><tr className="summary-row page-summary-row">{columns.length > 1 ? <td colSpan={columns.length}>当前页汇总</td> : <><td>当前页汇总</td>{columns.slice(1).map((column) => <td key={`direction-page-${column}`}>-</td>)}</>}<td className="num strong-cell">{formatNumber(shownSummary.amount)}</td><td className="num strong-cell">{formatNumber(shownSummary.count)}</td></tr><tr className="summary-row overall-summary-row">{columns.length > 1 ? <td colSpan={columns.length}>全部汇总</td> : <><td>全部汇总</td>{columns.slice(1).map((column) => <td key={`direction-all-${column}`}>-</td>)}</>}<td className="num strong-cell">{formatNumber(totalSummary.amount)}</td><td className="num strong-cell">{formatNumber(totalSummary.count)}</td></tr></tfoot></table></div>
    </div>
  );
}

function AliasCheckPanel({ aliasRows }: { aliasRows: Array<{ name: string; aliases: string[] }> }) {
  return <div className="panel"><div className="panel-head"><div><h2>统一三方识别校验</h2><p>保留人工确认等业务处理通道；已过滤商户余额不足、错误文本、纯数字和 hash 映射码。</p></div></div><div className="mini-list">{aliasRows.map((row, index) => <div className="rank-item" key={row.name}><div className="rank-no">{index + 1}</div><div><div className="rank-name">{row.name}</div><div className="rank-sub">{row.aliases.slice(0, 12).join(" / ")}</div></div><div className="rank-value">{row.aliases.length}</div></div>)}{!aliasRows.length && <div className="empty">暂无需要校验的别名</div>}</div></div>;
}

function FeeCompareTable({ rows, compact, title = "费率对比明细", showDate }: { rows: FeeCompareRow[]; compact?: boolean; title?: string; showDate?: boolean }) {
  const [selected, setSelected] = useState<FeeCompareRow | null>(null);
  const pager = usePagination(rows, !compact);
  const shown = compact ? rows.slice(0, 30) : pager.shown;
  const shownSummary = sumFeeCompareSummaryRows(shown);
  const totalSummary = sumFeeCompareSummaryRows(rows);
  return (
    <div className="panel fee-compare-panel">
      <div className="panel-head"><div><h2>{title}</h2><p>重点看每天什么盘跑了什么三方：高费率高跑量、低费率低跑量、未匹配费率都会提醒。</p></div></div>
      {!compact && <TablePager total={rows.length} page={pager.page} pageSize={pager.pageSize} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />}
      <div className="table-wrap work-table-wrap fee-compare-wrap">
        <table>
          <thead><tr>{showDate && <th>日期</th>}<th>国家</th><th>平台</th><th>统一三方</th><th>钱包/通道</th><th className="num">代收金额</th><th>代收费率</th><th className="num">代收手续费</th><th>代收占比</th><th className="num">代付金额</th><th>代付费率</th><th className="num">代付手续费</th><th>代付占比</th><th className="num">预估费用</th><th>总有效费率</th><th>判断</th><th>详情</th></tr></thead>
          <tbody>{shown.map((row) => <tr key={row.key} className={row.level !== "normal" ? "warning-row" : ""}>{showDate && <td>{row.date || "-"}</td>}<td>{row.country}</td><td>{row.platform}</td><td>{row.channel}</td><td>{row.channelType || "-"}</td><td className="num">{formatNumber(row.collectAmount)}</td><td>{feeCompareRateText(row, "collect")}</td><td className="num">{(row.collectFeeRate || row.collectSingleFee || row.collectFeeAmount || row.collectFeeKnownZero) ? formatNumber(row.collectFeeAmount) : "-"}</td><td>{formatPercent(row.collectShare)}</td><td className="num">{formatNumber(row.payoutAmount)}</td><td>{feeCompareRateText(row, "payout")}</td><td className="num">{(row.payoutFeeRate || row.payoutSingleFee || row.payoutFeeAmount || row.payoutFeeKnownZero) ? formatNumber(row.payoutFeeAmount) : "-"}</td><td>{formatPercent(row.payoutShare)}</td><td className="num strong-cell">{formatNumber(row.estimatedFee)}</td><td>{row.effectiveTotalFeeRate ? formatPercent(row.effectiveTotalFeeRate) : "-"}</td><td>{row.advice}</td><td><button className="mini-btn" onClick={() => setSelected(row)}>查看</button></td></tr>)}{!shown.length && <tr><td colSpan={(showDate ? 17 : 16)} className="empty">暂无可对比数据</td></tr>}</tbody>
          <tfoot>
            <tr className="summary-row page-summary-row">{showDate && <td>当前页汇总</td>}<td>{showDate ? '-' : '当前页汇总'}</td><td>-</td><td>-</td><td>-</td><td className="num">{formatNumber(shownSummary.collectAmount)}</td><td>{shownSummary.collectAmount ? formatPercent(shownSummary.collectFeeAmount / shownSummary.collectAmount) : '-'}</td><td className="num">{formatNumber(shownSummary.collectFeeAmount)}</td><td>{formatPercent(shownSummary.collectShare)}</td><td className="num">{formatNumber(shownSummary.payoutAmount)}</td><td>{shownSummary.payoutAmount ? formatPercent(shownSummary.payoutFeeAmount / shownSummary.payoutAmount) : '-'}</td><td className="num">{formatNumber(shownSummary.payoutFeeAmount)}</td><td>{formatPercent(shownSummary.payoutShare)}</td><td className="num strong-cell">{formatNumber(shownSummary.estimatedFee)}</td><td>{shownSummary.collectAmount + shownSummary.payoutAmount ? formatPercent(shownSummary.estimatedFee / (shownSummary.collectAmount + shownSummary.payoutAmount)) : "-"}</td><td>{formatPercent(shownSummary.totalShare)}</td><td className="muted-cell">汇总</td></tr>
            <tr className="summary-row overall-summary-row">{showDate && <td>全部汇总</td>}<td>{showDate ? '-' : '全部汇总'}</td><td>-</td><td>-</td><td>-</td><td className="num">{formatNumber(totalSummary.collectAmount)}</td><td>{totalSummary.collectAmount ? formatPercent(totalSummary.collectFeeAmount / totalSummary.collectAmount) : '-'}</td><td className="num">{formatNumber(totalSummary.collectFeeAmount)}</td><td>100.00%</td><td className="num">{formatNumber(totalSummary.payoutAmount)}</td><td>{totalSummary.payoutAmount ? formatPercent(totalSummary.payoutFeeAmount / totalSummary.payoutAmount) : '-'}</td><td className="num">{formatNumber(totalSummary.payoutFeeAmount)}</td><td>100.00%</td><td className="num strong-cell">{formatNumber(totalSummary.estimatedFee)}</td><td>{totalSummary.collectAmount + totalSummary.payoutAmount ? formatPercent(totalSummary.estimatedFee / (totalSummary.collectAmount + totalSummary.payoutAmount)) : "-"}</td><td>100.00%</td><td className="muted-cell">汇总</td></tr>
          </tfoot>
        </table>
      </div>
      {selected && <FeeDetailModal row={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function FeeAnomalyPanel({ rows }: { rows: FeeCompareRow[] }) {
  return <CountryFeeSections rows={rows} title="费率异常提醒" subtitle="按国家分区，重点看同类型内总费率贵的跑多、总费率便宜的跑少。" showDate />;
}

function FeeDetailModal({ row, onClose }: { row: FeeCompareRow; onClose: () => void }) {
  return (
    <div className="modal-backdrop"><div className="detail-modal rate-row-modal">
      <div className="detail-modal-header"><div><h3>{row.date ? `${row.date} / ` : ""}{row.country} / {row.platform} / {row.channel}{row.channelType ? ` / ${row.channelType}` : ""}</h3><p>{row.advice}</p></div><button className="modal-close-btn" type="button" onClick={onClose}>关闭</button></div>
      <div className="modal-summary-grid"><div><span>代收金额</span><strong>{formatNumber(row.collectAmount)}</strong><p>费率 {row.collectFeeRate ? formatPercent(row.collectFeeRate) : "-"} · 单笔 {row.collectSingleFee ? formatSingleFeeValue(row.collectSingleFee) : "-"} · 手续费 {(row.collectFeeRate || row.collectSingleFee || row.collectFeeAmount || row.collectFeeKnownZero) ? formatNumber(row.collectFeeAmount) : "-"}</p></div><div><span>代付金额</span><strong>{formatNumber(row.payoutAmount)}</strong><p>费率 {row.payoutFeeRate ? formatPercent(row.payoutFeeRate) : "-"} · 单笔 {row.payoutSingleFee ? formatSingleFeeValue(row.payoutSingleFee) : "-"} · 手续费 {(row.payoutFeeRate || row.payoutSingleFee || row.payoutFeeAmount || row.payoutFeeKnownZero) ? formatNumber(row.payoutFeeAmount) : "-"}</p></div><div><span>跑量占比</span><strong>{formatPercent(row.totalShare)}</strong><p>按同国家{row.date ? "同日" : "累计"}同类型三方量对比</p></div><div><span>预估费用</span><strong>{formatNumber(row.estimatedFee)}</strong><p>代收手续费 + 代付手续费</p></div><div><span>总有效费率</span><strong>{row.effectiveTotalFeeRate ? formatPercent(row.effectiveTotalFeeRate) : "-"}</strong><p>合计手续费 ÷ 合计金额</p></div></div>
    </div></div>
  );
}

function TextAnomalyPanel({ rows, compact }: { rows: string[]; compact?: boolean }) {
  const list = compact ? rows.slice(0, 18) : rows;
  return <div className="panel"><div className="panel-head"><div><h2>{compact ? "异常摘要" : "三方量异常提醒"}</h2><p>高跑量、别名过多、费率异常会在这里提示。</p></div></div><div className="alert-list">{(list.length ? list : ["当前筛选范围暂无明显异常。"]).map((item, index) => <div className="alert-item" key={index}><span className="alert-dot" /><span>{item}</span></div>)}</div></div>;
}

function DetailTable({ rows }: { rows: ThirdPartyVolumeRow[] }) {
  const pager = usePagination(rows, true);
  const shownSummary = sumRawVolumeRows(pager.shown);
  const totalSummary = sumRawVolumeRows(rows);
  return (
    <div className="panel">
      <div className="panel-head"><div><h2>原始明细</h2><p>显示当前筛选后的 raw 明细，方便核对；人工确认会正常保留；商户余额不足和错误文本在读取层过滤。</p></div></div>
      <TablePager total={rows.length} page={pager.page} pageSize={pager.pageSize} onPageChange={pager.setPage} onPageSizeChange={pager.setPageSize} />
      <div className="table-wrap work-table-wrap"><table><thead><tr><th>日期</th><th>国家</th><th>平台</th><th>类型</th><th>统一三方</th><th>原始名称</th><th className="num">金额</th><th className="num">笔数</th><th>来源页签</th></tr></thead><tbody>{pager.shown.map((row) => <tr key={row.id}><td>{row.date}</td><td>{row.country}</td><td>{row.platform}</td><td>{row.direction}</td><td>{row.channel}</td><td>{row.rawChannel}</td><td className="num">{formatNumber(row.amount)}</td><td className="num">{formatNumber(row.count)}</td><td>{row.sheetName} #{row.sourceRow}</td></tr>)}{!pager.shown.length && <tr><td colSpan={9} className="empty">暂无明细数据</td></tr>}</tbody><tfoot><tr className="summary-row page-summary-row"><td colSpan={6}>当前页汇总</td><td className="num strong-cell">{formatNumber(shownSummary.amount)}</td><td className="num strong-cell">{formatNumber(shownSummary.count)}</td><td className="muted-cell">汇总</td></tr><tr className="summary-row overall-summary-row"><td colSpan={6}>全部汇总</td><td className="num strong-cell">{formatNumber(totalSummary.amount)}</td><td className="num strong-cell">{formatNumber(totalSummary.count)}</td><td className="muted-cell">汇总</td></tr></tfoot></table></div>
    </div>
  );
}
