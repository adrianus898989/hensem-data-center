import { google } from "googleapis";
import { buildPayloadFromSheets } from "./parseAutoWithdraw";
import { buildThirdPartyRatePayload } from "./parseThirdPartyRates";
import { buildWorkOrderPayload } from "./parseWorkOrders";
import { buildCustomerServicePayload } from "./parseCustomerService";
import { buildThirdPartyVolumePayload } from "./parseThirdPartyVolume";
import { WORK_ORDER_SOURCE_CONFIG } from "./workOrderSourceConfig";
import type { AutoWithdrawPayload, ThirdPartyRatePayload, WorkOrderPayload, CustomerServicePayload, ThirdPartyVolumePayload } from "./types";
import { demoData } from "./demoData";

const DEFAULT_AUTO_WITHDRAW_RAW_SHEET_ID = "1YILuFYg4ZMASsDTsDMiF4-YKp7SLU6ouVopbK5LVQxc";
const DEFAULT_THIRD_PARTY_RATE_SHEET_ID = "15vq88fo9AU0EXzheSkuIgN03RPsQLDT-5XzXkBf-cyA";
const DEFAULT_THIRD_PARTY_VOLUME_SHEET_IDS = [
  "1eTVG5xdOFioiOTESUtO0oAMy2rkU7AgGdMExS_mGE00",
  "1ue_ycApblBCp2BvxxVcFjM5geFAmg7yzul6a6xuIVtk"
];
const DEFAULT_CUSTOMER_SERVICE_SHEET_ID = "1-vvfQq7Sys9rBWvu2X9JauZ6wtMQcn2Oz3OTb65LlkE";


function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function normalizePrivateKey(key: string): string {
  return key
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n");
}

function sheetRange(sheetName: string, range = "A1:ZZ5000"): string {
  const safe = sheetName.replace(/'/g, "''");
  return `'${safe}'!${range}`;
}

function splitEnvList(value: string): string[] {
  return String(value || "")
    .split(/[\\n,]+/)
    .map((x) => x.replace(/[\u200B-\u200D\uFEFF]/g, "").trim())
    .filter(Boolean);
}

function listFromEnv(name: string, fallback: string[]): string[] {
  const value = process.env[name];
  if (!value) return fallback;
  return splitEnvList(value);
}

function combineUnique(...groups: string[][]): string[] {
  return Array.from(new Set(groups.flat().map((item) => String(item || "").trim()).filter(Boolean)));
}

function spreadsheetIdFromInput(value: string): string {
  const text = String(value || "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const match = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1].trim();
  return text.split(/[?#]/)[0].replace(/\/edit.*$/, "").trim();
}

function spreadsheetIdsFromEnv(multiName: string, singleNames: string[]): string[] {
  const multi = listFromEnv(multiName, []).map(spreadsheetIdFromInput).filter(Boolean);
  if (multi.length) return Array.from(new Set(multi));

  const singles = singleNames
    .flatMap((name) => splitEnvList(process.env[name] || ""))
    .map(spreadsheetIdFromInput)
    .filter(Boolean);
  return Array.from(new Set(singles));
}

type SpreadsheetSheetMeta = { properties?: { title?: string; gridProperties?: { rowCount?: number; columnCount?: number } } };

type SheetGridMeta = { rowCount: number; columnCount: number };

function sheetGridMetaMap(metadata: any): Record<string, SheetGridMeta> {
  const out: Record<string, SheetGridMeta> = {};
  for (const sheet of ((metadata?.data?.sheets || []) as SpreadsheetSheetMeta[])) {
    const title = sheet.properties?.title?.replace(/[​-‍﻿]/g, "").trim();
    if (!title) continue;
    const grid = sheet.properties?.gridProperties || {};
    out[title] = {
      rowCount: Math.max(1, Number(grid.rowCount || 0) || 0),
      columnCount: Math.max(1, Number(grid.columnCount || 0) || 0)
    };
  }
  return out;
}

function sheetTitlesFromMetadata(metadata: any): string[] {
  return ((metadata?.data?.sheets || []) as SpreadsheetSheetMeta[])
    .map((sheet: SpreadsheetSheetMeta) => sheet.properties?.title)
    .filter((name): name is string => !!name)
    .map((name) => name.replace(/[\u200B-\u200D\uFEFF]/g, "").trim())
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown");
}

function isTransientGoogleError(error: unknown): boolean {
  const message = errorMessage(error);
  return /Quota exceeded|rateLimitExceeded|userRateLimitExceeded|Read requests|timeout|ETIMEDOUT|ECONNRESET|503|500/i.test(message);
}

async function withGoogleRetry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let index = 0; index < attempts; index++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientGoogleError(error) || index === attempts - 1) break;
      await sleep(1200 * (index + 1));
    }
  }
  throw new Error(`${label}: ${errorMessage(lastError)}`);
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

export type AutoWithdrawReadOptions = {
  months?: string[];
  forceAll?: boolean;
};

export type MonthlySheetReadOptions = {
  months?: string[];
  forceAll?: boolean;
};

export type ThirdPartyVolumeReadOptions = {
  startDate?: string;
  endDate?: string;
  months?: string[];
  forceAll?: boolean;
  // V216：定时任务按「来源表 + 页签分片」读取，避免 Netlify 60 秒超时。
  // 0 = 第一个三方量表，1 = 第二个三方量表。
  sourceIndexes?: number[];
  // 例如 sheetModulo=2, sheetRemainder=0 只读当前来源表里一半页签；下一次读另一半。
  sheetModulo?: number;
  sheetRemainder?: number;
  // V216：横向大表可按列分片，避免单个 raw_2026_07_代收 读完整张超 60 秒。
  columnModulo?: number;
  columnRemainder?: number;
};

function toYyyyMm(value: string): string {
  const text = String(value || "").trim();
  const m = text.match(/(20\d{2})[-_\/.年]?(\d{1,2})/);
  if (!m) return "";
  return `${m[1]}_${m[2].padStart(2, "0")}`;
}

function dateToYyyyMm(date: Date): string {
  return `${date.getFullYear()}_${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(startDate: string, endDate: string): string[] {
  const start = String(startDate || "").match(/(20\d{2})[-\/](\d{1,2})/);
  const end = String(endDate || "").match(/(20\d{2})[-\/](\d{1,2})/);
  if (!start || !end) return [];
  const cur = new Date(Number(start[1]), Number(start[2]) - 1, 1);
  const last = new Date(Number(end[1]), Number(end[2]) - 1, 1);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime())) return [];
  const out: string[] = [];
  while (cur <= last && out.length < 24) {
    out.push(dateToYyyyMm(cur));
    cur.setMonth(cur.getMonth() + 1);
  }
  return out;
}

function defaultThirdPartyVolumeMonths(): string[] {
  const now = new Date();
  const current = dateToYyyyMm(now);
  const yesterday = new Date(now.getTime() - 86400000);
  const prev = dateToYyyyMm(yesterday);
  return Array.from(new Set([current, prev]));
}

function configuredOrAllThirdPartyMonths(): string[] {
  const configured = listFromEnv("THIRD_PARTY_VOLUME_MONTHS", []);
  if (configured.length) return configured.map(toYyyyMm).filter(Boolean);
  // 默认保守读 2026 年 4-12 月；页面实际按日期筛选。
  // 这比读取整张历史总表稳定，也能覆盖你现在 4/5/6/7 的历史数据。
  return ["2026_04", "2026_05", "2026_06", "2026_07", "2026_08", "2026_09", "2026_10", "2026_11", "2026_12"];
}

function monthKeysFromVolumeOptions(options?: ThirdPartyVolumeReadOptions): string[] {
  if (options?.forceAll) return configuredOrAllThirdPartyMonths();
  const fromExplicit = (options?.months || [])
    .map(toYyyyMm)
    .filter(Boolean);
  if (fromExplicit.length) return Array.from(new Set(fromExplicit));

  const fromRange = monthsBetween(options?.startDate || "", options?.endDate || options?.startDate || "");
  if (fromRange.length) return fromRange;

  // 页面无快照时只读当前/昨日所在月，避免上传新版本后现场读全量导致接口空白。
  // 定时/手动快照会用 forceAll 读取配置月份。
  return defaultThirdPartyVolumeMonths();
}

function sheetNameMatchesMonthKeys(sheetName: string, monthKeys: string[]): boolean {
  if (!monthKeys.length) return true;
  const normalized = String(sheetName || "").replace(/[\s\-\/年月]/g, "_");
  return monthKeys.some((month) => {
    const [year, mm] = month.split("_");
    const m = String(Number(mm));
    const patterns = [
      `${year}_${mm}`,
      `${year}_${m}`,
      `${year}${mm}`,
      `${year}${m}`
    ];
    return patterns.some((pattern) => normalized.includes(pattern));
  });
}

export async function getAutoWithdrawPayload(options: AutoWithdrawReadOptions = {}): Promise<AutoWithdrawPayload> {
  const useDemo = (process.env.USE_DEMO_DATA || "false").toLowerCase() === "true";

  try {
    const spreadsheetId = requiredEnv("GOOGLE_SHEET_ID");
    const clientEmail = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
    const privateKey = normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY"));

    const countrySheets = listFromEnv("COUNTRY_SHEETS", [
      "印度盘口",
      "南美盘口",
      "巴基斯坦盘口",
      "巴西盘口",
      "胖虎巴西盘口",
      "越南盘口",
      "印尼盘口",
      "马来盘口",
      "缅甸盘口",
      "菲律宾盘口"
    ]);

    const operatorSheetName = process.env.OPERATOR_SHEET_NAME || "操作人统计";

    // V218：AUTO_WITHDRAW_RAW_SHEET_ID 现在支持多个表 ID。
    // 你的 Netlify 里已经是 `旧AR_RAW,新AR_RAW` 这种写法，旧版本把整串当成一个 ID，
    // 所以 Google 返回 Requested entity was not found，自动出款会停在旧快照。
    const rawSpreadsheetIds = spreadsheetIdsFromEnv("AUTO_WITHDRAW_RAW_SHEET_IDS", [
      "AUTO_WITHDRAW_RAW_SHEET_ID",
      "AUTO_WITHDRAW_RAW_SPREADSHEET_ID",
      "OPERATOR_RAW_SHEET_ID",
      "OPERATOR_RAW_SPREADSHEET_ID"
    ]);
    if (!rawSpreadsheetIds.length && DEFAULT_AUTO_WITHDRAW_RAW_SHEET_ID) {
      rawSpreadsheetIds.push(DEFAULT_AUTO_WITHDRAW_RAW_SHEET_ID);
    }
    const hasConfiguredRawSheet = rawSpreadsheetIds.length > 0;
    const autoMonthKeys = options.forceAll ? [] : (options.months || []).map(toYyyyMm).filter(Boolean);
    const configuredRawDailySheets = listFromEnv("AUTO_WITHDRAW_RAW_DAILY_SHEETS", []);
    const configuredRawOperatorSheets = listFromEnv("OPERATOR_RAW_SHEETS", []);
    const rawWarnings: string[] = [];
    const rawDailyKeys: string[] = [];
    const rawOperatorKeys: string[] = [];
    const rawDailyDisplayNames: string[] = [];
    const rawOperatorDisplayNames: string[] = [];

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
    });

    const sheets = google.sheets({ version: "v4", auth });
    const result: Record<string, string[][]> = {};

    const fallbackRawSheetNames = (prefix: "raw_daily" | "raw_operator_daily"): string[] => {
      const configuredYear = String(process.env.AUTO_WITHDRAW_RAW_YEAR || "").trim();
      const currentYear = new Date().getFullYear();
      const years = Array.from(new Set([
        configuredYear && /^20\d{2}$/.test(configuredYear) ? Number(configuredYear) : currentYear,
        currentYear,
        currentYear - 1,
        currentYear + 1
      ]));
      const names: string[] = [];
      for (const year of years) {
        for (let month = 1; month <= 12; month++) {
          names.push(`${prefix}_${year}_${String(month).padStart(2, "0")}`);
        }
      }
      return names;
    };

    type RawSourcePlan = {
      spreadsheetId: string;
      sourceIndex: number;
      gridMetaBySheet: Record<string, SheetGridMeta>;
      dailySheets: string[];
      operatorSheets: string[];
    };

    const detectRawSheetNames = async (spreadsheetId: string, sourceIndex: number): Promise<RawSourcePlan> => {
      let rawGridMetaBySheet: Record<string, SheetGridMeta> = {};
      let dailySheets = configuredRawDailySheets;
      let operatorSheets = configuredRawOperatorSheets;
      let metadataFailed = false;
      try {
        const metadata = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
        const rawSheetNames = sheetTitlesFromMetadata(metadata);
        rawGridMetaBySheet = sheetGridMetaMap(metadata);
        let detectedDailySheets = rawSheetNames.filter((name) => /^raw[_-]daily[_-]20\d{2}[_-]\d{2}$/i.test(name));
        let detectedOperatorSheets = rawSheetNames.filter((name) => /^raw[_-]operator[_-]daily[_-]20\d{2}[_-]\d{2}$/i.test(name));
        if (autoMonthKeys.length) {
          detectedDailySheets = detectedDailySheets.filter((name) => sheetNameMatchesMonthKeys(name, autoMonthKeys));
          detectedOperatorSheets = detectedOperatorSheets.filter((name) => sheetNameMatchesMonthKeys(name, autoMonthKeys));
        }
        // V218：配置的 raw_daily_xxx / raw_operator_daily_xxx 只能在“当前这个表真实存在”时读取。
        // 之前如果 AUTO_WITHDRAW_RAW_SHEET_ID 放了多个表，而第二个表没有 raw_daily_2026_07，
        // 仍会硬读这个页签，Google 就返回 Unable to parse range。现在直接跳过该来源不存在的页签。
        const rawNameSet = new Set(rawSheetNames.map((name) => name.replace(/[​-‍﻿]/g, "").trim()));
        const configuredDailyExisting = configuredRawDailySheets.filter((name) => rawNameSet.has(name));
        const configuredOperatorExisting = configuredRawOperatorSheets.filter((name) => rawNameSet.has(name));
        dailySheets = combineUnique(configuredDailyExisting, detectedDailySheets).sort();
        operatorSheets = combineUnique(configuredOperatorExisting, detectedOperatorSheets).sort();
        if (configuredRawDailySheets.length && !configuredDailyExisting.length && autoMonthKeys.length) {
          rawWarnings.push(`AUTO_WITHDRAW_RAW 表${sourceIndex + 1} 没有 ${configuredRawDailySheets.join(",")}，已跳过这个来源的日表，不影响其它表`);
        }
        if (configuredRawOperatorSheets.length && !configuredOperatorExisting.length && autoMonthKeys.length) {
          rawWarnings.push(`AUTO_WITHDRAW_RAW 表${sourceIndex + 1} 没有 ${configuredRawOperatorSheets.join(",")}，已跳过这个来源的操作人表，不影响其它表`);
        }
      } catch (error) {
        metadataFailed = true;
        const msg = error instanceof Error ? error.message : "未知错误";
        rawWarnings.push(`AUTO_WITHDRAW_RAW 表${sourceIndex + 1} 元数据读取失败：${msg}`);
        rawWarnings.push(`请确认该表已分享给 ${clientEmail}`);
      }

      // V218：如果 metadata 已经读到了该文件真实页签，但当前月份页签不存在，就直接跳过这个来源。
      // 不能再 fallback 去硬读 raw_daily_2026_07，否则第二个旧表没有 7 月页签时会一直报 Unable to parse range。
      if (!dailySheets.length) dailySheets = [];
      if (!operatorSheets.length) operatorSheets = [];
      if (autoMonthKeys.length) {
        dailySheets = dailySheets.filter((name) => sheetNameMatchesMonthKeys(name, autoMonthKeys));
        operatorSheets = operatorSheets.filter((name) => sheetNameMatchesMonthKeys(name, autoMonthKeys));
      }
      return { spreadsheetId, sourceIndex, gridMetaBySheet: rawGridMetaBySheet, dailySheets, operatorSheets };
    };

    const rawKey = (plan: RawSourcePlan, sheetName: string): string => {
      return rawSpreadsheetIds.length > 1 ? `[自动出款RAW${plan.sourceIndex + 1}] ${sheetName}` : sheetName;
    };

    const readRawMany = async (plan: RawSourcePlan, names: string[], range: string, kind: "daily" | "operator"): Promise<void> => {
      for (const name of names) {
        const fallbackCols = kind === "operator" ? 10 : 12;
        const safeRange = capA1RangeToGrid(range, plan.gridMetaBySheet[name], fallbackCols, 200000);
        const key = rawKey(plan, name);
        try {
          const response: any = await withGoogleRetry(
            () => sheets.spreadsheets.values.get({ spreadsheetId: plan.spreadsheetId, range: sheetRange(name, safeRange) }),
            `读取自动出款 raw 表${plan.sourceIndex + 1} ${plan.spreadsheetId}/${name}/${safeRange}`
          );
          const values = (response.data.values || []) as string[][];
          result[key] = values;
          if (kind === "daily") {
            rawDailyKeys.push(key);
            rawDailyDisplayNames.push(`表${plan.sourceIndex + 1}:${name}`);
          } else {
            rawOperatorKeys.push(key);
            rawOperatorDisplayNames.push(`表${plan.sourceIndex + 1}:${name}`);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : "未知错误";
          rawWarnings.push(`表${plan.sourceIndex + 1}:${name} 读取失败：${msg}`);
          result[key] = [];
          if (kind === "daily") rawDailyKeys.push(key);
          else rawOperatorKeys.push(key);
        }
      }
    };

    // 1) 自动出款原始 RAW：支持多个表，顺序读取，避免一个表 ID 错误拖死全部。
    if (hasConfiguredRawSheet) {
      for (const [sourceIndex, rawSpreadsheetId] of rawSpreadsheetIds.entries()) {
        const plan = await detectRawSheetNames(rawSpreadsheetId, sourceIndex);
        await readRawMany(plan, plan.dailySheets, process.env.AUTO_WITHDRAW_RAW_DAILY_RANGE || "A1:L200000", "daily");
        await readRawMany(plan, plan.operatorSheets, process.env.AUTO_WITHDRAW_RAW_OPERATOR_RANGE || "A1:J200000", "operator");
      }
    }

    let payload = buildPayloadFromSheets(result, operatorSheetName, rawOperatorKeys, rawDailyKeys);
    let parsedRawDailyRows = payload.dailyRows.length;
    let parsedRawOperatorRows = payload.operatorRows.length;

    // V212：如果当前月份 raw 页签存在但全部读取/解析为 0，而且已经有读取失败提示，直接抛出真实错误。
    // 这样 scheduled function 会马上重试，并保留旧快照；不会再变成“返回错误信息但不知道错在哪里”。
    const expectedRawSheets = rawDailyKeys.length + rawOperatorKeys.length;
    if (hasConfiguredRawSheet && expectedRawSheets > 0 && parsedRawDailyRows === 0 && parsedRawOperatorRows === 0 && rawWarnings.some((x) => x.includes("读取失败"))) {
      throw new Error(`AUTO_WITHDRAW_RAW 当前月份读取失败：${rawWarnings.slice(0, 6).join("；")}`);
    }

    // 2) 只有 raw 没读到有效数据时，才回退读取旧 GOOGLE_SHEET_ID 的国家盘口表。
    //    这样不会把旧“巴西盘口 / 胖虎巴西盘口”等表的数据混进来造成重复，也不会把 234T 算进普通巴西。
    if (!parsedRawDailyRows && !parsedRawOperatorRows) {
      const requiredSheets = [...countrySheets, operatorSheetName];
      await Promise.all(requiredSheets.map(async (name) => {
        try {
          const response = await sheets.spreadsheets.values.get({ spreadsheetId, range: sheetRange(name) });
          result[name] = (response.data.values || []) as string[][];
        } catch (error) {
          const msg = error instanceof Error ? error.message : "未知错误";
          rawWarnings.push(`${name} 旧表读取失败：${msg}`);
          result[name] = [];
        }
      }));
      payload = buildPayloadFromSheets(result, operatorSheetName, rawOperatorKeys, rawDailyKeys);
      parsedRawDailyRows = payload.dailyRows.length;
      parsedRawOperatorRows = payload.operatorRows.length;
    }

    const rawDailySheetRows = rawDailyKeys.reduce((sum, name) => sum + Math.max((result[name] || []).length - 1, 0), 0);
    const rawOperatorSheetRows = rawOperatorKeys.reduce((sum, name) => sum + Math.max((result[name] || []).length - 1, 0), 0);
    const existingRawDailySheets = rawDailyKeys.filter((name) => (result[name] || []).length > 0);
    const existingRawOperatorSheets = rawOperatorKeys.filter((name) => (result[name] || []).length > 0);
    const rawInfo = hasConfiguredRawSheet
      ? parsedRawDailyRows > 0 || parsedRawOperatorRows > 0
        ? `AUTO_WITHDRAW_RAW_SHEET_ID 已读取：日表 ${existingRawDailySheets.length} 个/${formatRawCount(rawDailySheetRows)} 行，操作人表 ${existingRawOperatorSheets.length} 个/${formatRawCount(rawOperatorSheetRows)} 行。`
        : `AUTO_WITHDRAW_RAW_SHEET_ID 已配置，但没有解析到有效数据；已尝试回退旧自动出款表。`
      : `未配置 AUTO_WITHDRAW_RAW_SHEET_ID，当前读取 GOOGLE_SHEET_ID 旧自动出款表。`;

    return {
      ...payload,
      meta: {
        ...payload.meta,
        message: [rawInfo, autoMonthKeys.length ? `本次自动同步只刷新 ${autoMonthKeys.join(",")}，历史月份沿用上一次成功快照。` : "", ...rawWarnings].filter(Boolean).join("；"),
        rawSourceId: rawSpreadsheetIds.join(","),
        rawDailySheets: existingRawDailySheets.length ? existingRawDailySheets : rawDailyDisplayNames,
        rawOperatorSheets: existingRawOperatorSheets.length ? existingRawOperatorSheets : rawOperatorDisplayNames,
        rawDailyRows: rawDailySheetRows,
        rawOperatorRows: rawOperatorSheetRows
      }
    };
  } catch (error) {
    if (!useDemo) throw error;
    return {
      ...demoData,
      meta: {
        ...demoData.meta,
        updatedAt: new Date().toISOString(),
        message:
          error instanceof Error
            ? `当前显示 Demo 数据。真实表格读取失败：${error.message}`
            : "当前显示 Demo 数据。真实表格读取失败。"
      }
    };
  }
}

function formatRawCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}


export async function getThirdPartyRatePayload(): Promise<ThirdPartyRatePayload> {
  const rateSheetInput = process.env.THIRD_PARTY_RATE_SHEET_ID || process.env.THIRD_PARTY_RATE_SPREADSHEET_ID || process.env.THIRD_PARTY_RATE_SHEET_URL || DEFAULT_THIRD_PARTY_RATE_SHEET_ID || "";
  if (!rateSheetInput) throw new Error("Missing environment variable THIRD_PARTY_RATE_SHEET_ID");
  const spreadsheetId = spreadsheetIdFromInput(rateSheetInput);
  const clientEmail = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY"));

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  const metadata: any = await withGoogleRetry(
    () => sheets.spreadsheets.get({ spreadsheetId, includeGridData: false }),
    "读取三方费率页签列表"
  );
  const allSheetNames = sheetTitlesFromMetadata(metadata);

  const configuredSheets = listFromEnv("THIRD_PARTY_RATE_SHEETS", []);
  const targetSheets = configuredSheets.length ? configuredSheets : allSheetNames;
  const result: Record<string, string[][]> = {};

  for (const chunk of chunkArray(targetSheets, 20)) {
    try {
      const ranges = chunk.map((name) => sheetRange(name, "A1:ZZ800"));
      const response: any = await withGoogleRetry(
        () => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }),
        `批量读取三方费率 ${chunk[0]} 等 ${chunk.length} 个页签`
      );
      const valueRanges = response.data.valueRanges || [];
      chunk.forEach((name, index) => {
        result[name] = (valueRanges[index]?.values || []) as string[][];
      });
    } catch {
      chunk.forEach((name) => { result[name] = []; });
    }
  }

  return buildThirdPartyRatePayload(result);
}




function isCompactThirdPartyRawSheet(sheetName: string): boolean {
  const name = String(sheetName || "").toLowerCase();
  return /^raw[_-]?20\d{2}[_-]\d{2}[_-]?(代收|代付|collect|payout|deposit|withdraw)/i.test(sheetName)
    || /^raw[_-]20\d{2}[_-]\d{2}/i.test(sheetName)
    || /raw[_-].*20\d{2}[_-]\d{2}.*(代收|代付|collect|payout|deposit|withdraw)/i.test(sheetName);
}

function columnName(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function columnIndexFromName(name: string): number {
  const text = String(name || "").toUpperCase().replace(/[^A-Z]/g, "");
  let n = 0;
  for (const ch of text) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function capA1RangeToGrid(range: string, grid?: SheetGridMeta, fallbackCols = 26, fallbackRows = 5000): string {
  const rowCount = Math.max(1, Number(grid?.rowCount || 0) || fallbackRows);
  const columnCount = Math.max(1, Number(grid?.columnCount || 0) || fallbackCols);
  const text = String(range || "A1:Z5000").trim();
  const m = text.match(/^([A-Z]+)(\d*)\s*:\s*([A-Z]+)(\d*)$/i);
  if (!m) return `A1:${columnName(Math.min(columnCount, fallbackCols) - 1)}${Math.min(rowCount, fallbackRows)}`;
  const startCol = columnIndexFromName(m[1]);
  const startRow = Math.max(1, Number(m[2] || 1) || 1);
  const requestedEndCol = columnIndexFromName(m[3]);
  const requestedEndRow = Math.max(startRow, Number(m[4] || rowCount) || rowCount);
  const endCol = Math.max(startCol, Math.min(requestedEndCol, columnCount - 1));
  const endRow = Math.max(startRow, Math.min(requestedEndRow, rowCount));
  return `${columnName(startCol)}${startRow}:${columnName(endCol)}${endRow}`;
}

function thirdPartyVolumeRangesForSheet(
  sheetName: string,
  defaultRange: string,
  maxRows: number,
  grid?: SheetGridMeta,
  columnModulo = 1,
  columnRemainder = 0
): string[] {
  if (!isCompactThirdPartyRawSheet(sheetName)) return [capA1RangeToGrid(defaultRange, grid, 120, maxRows)];

  const configured = splitEnvList(process.env.THIRD_PARTY_VOLUME_COMPACT_RANGES || "");
  if (configured.length) return configured;

  // V216：三方量 raw 表是横向国家分区表。一次读全列很容易在 Netlify 60 秒超时，
  // 所以按列分片读取；分片之间保留 12 列重叠，避免刚好切在国家区块中间导致漏块。
  const colCount = Math.max(1, Math.min(512, Number(grid?.columnCount || 0) || 120));
  const rowCount = Math.max(1, Math.min(maxRows, Number(grid?.rowCount || 0) || maxRows));
  const chunkWidth = Math.max(30, Math.min(120, Number(process.env.THIRD_PARTY_VOLUME_COLUMN_CHUNK_WIDTH || "72") || 72));
  const overlap = Math.max(0, Math.min(20, Number(process.env.THIRD_PARTY_VOLUME_COLUMN_CHUNK_OVERLAP || "12") || 12));
  const step = Math.max(10, chunkWidth - overlap);
  const ranges: string[] = [];
  for (let start = 0; start < colCount; start += step) {
    const end = Math.min(colCount - 1, start + chunkWidth - 1);
    ranges.push(`${columnName(start)}1:${columnName(end)}${rowCount}`);
    if (end >= colCount - 1) break;
  }

  const modulo = Math.max(1, Math.floor(Number(columnModulo || 1) || 1));
  const remainder = Math.max(0, Math.floor(Number(columnRemainder || 0) || 0)) % modulo;
  return modulo > 1 ? ranges.filter((_, index) => index % modulo === remainder) : ranges;
}
function isLikelyHugeHistoryVolumeSheet(sheetName: string): boolean {
  return /历史|history|汇总|summary|总表|全部|all/i.test(String(sheetName || ""));
}

export async function getThirdPartyVolumePayload(options: ThirdPartyVolumeReadOptions = {}): Promise<ThirdPartyVolumePayload> {
  const clientEmail = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY"));
  let spreadsheetIds = spreadsheetIdsFromEnv("THIRD_PARTY_VOLUME_SHEET_IDS", ["THIRD_PARTY_VOLUME_SHEET_ID", "THIRD_PARTY_AMOUNT_SHEET_ID"]);
  // V211：如果 Netlify 环境变量漏填，不要直接让页面红屏/0 行；
  // 使用当前项目长期使用的两个三方量表 ID 作为兜底，失败的表会跳过，成功的表照常显示。
  if (!spreadsheetIds.length) {
    spreadsheetIds = DEFAULT_THIRD_PARTY_VOLUME_SHEET_IDS.filter(Boolean);
  }

  if (!spreadsheetIds.length) {
    throw new Error("Missing environment variable: THIRD_PARTY_VOLUME_SHEET_ID or THIRD_PARTY_VOLUME_SHEET_IDS");
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  const configuredSheets = listFromEnv("THIRD_PARTY_VOLUME_SHEETS", []);
  const monthKeys = monthKeysFromVolumeOptions(options);
  const rangeLimit = Math.max(5000, Number(process.env.THIRD_PARTY_VOLUME_MAX_ROWS || "60000") || 60000);
  const readRange = process.env.THIRD_PARTY_VOLUME_RANGE || `A1:ZZ${rangeLimit}`;
  const result: Record<string, string[][]> = {};
  const failedSheets: string[] = [];
  const sourceInfo: string[] = [];

  const sourceIndexes = Array.isArray(options.sourceIndexes)
    ? Array.from(new Set(options.sourceIndexes.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x >= 0)))
    : [];
  const spreadsheetSources = spreadsheetIds
    .map((spreadsheetId, index) => ({ spreadsheetId, sourceIndex: index }))
    .filter((item) => !sourceIndexes.length || sourceIndexes.includes(item.sourceIndex));

  if (!spreadsheetSources.length) {
    throw new Error(`三方量 sourceIndexes=${sourceIndexes.join(",")} 没有匹配到任何来源表`);
  }

  for (const { spreadsheetId, sourceIndex } of spreadsheetSources) {
    const fileIndex = sourceIndex;
    try {
      const metadata: any = await withGoogleRetry(
        () => sheets.spreadsheets.get({ spreadsheetId, includeGridData: false }),
        `读取三方量页签列表 ${spreadsheetId}`
      );
      const allSheetNames = sheetTitlesFromMetadata(metadata);
      const gridMetaBySheet = sheetGridMetaMap(metadata);
      const defaultVolumeSheets = allSheetNames.filter((name) => /^raw[_-]/i.test(name) || /raw.*(代收|代付|thirdparty|三方)/i.test(name));
      // V216：如果你在 Netlify 配了 THIRD_PARTY_VOLUME_SHEETS，只能作为“优先页签”。
      // 历史月份 2026_04/05/06 如果不在配置里，必须自动回到 metadata 里检测到的 raw_2026_04_代收/代付，
      // 否则 4/5/6 会永远 0 行。
      const configuredExisting = configuredSheets.filter((name) => allSheetNames.includes(name));
      const configuredMonthSheets = monthKeys.length ? configuredExisting.filter((name) => sheetNameMatchesMonthKeys(name, monthKeys)) : configuredExisting;
      const detectedBaseSheets = defaultVolumeSheets.length ? defaultVolumeSheets : allSheetNames;
      // V225：按月份读取时，环境变量页签只能补充，不能覆盖 metadata 自动检测结果。
      // 旧逻辑只要配置里碰巧命中一个月页签，就会只读那一个，导致同月代收/代付少一半。
      const baseSheets = monthKeys.length
        ? Array.from(new Set([...detectedBaseSheets, ...configuredMonthSheets]))
        : (configuredExisting.length ? configuredExisting : detectedBaseSheets);
      const monthFilteredSheets = monthKeys.length
        ? baseSheets.filter((name) => sheetNameMatchesMonthKeys(name, monthKeys))
        : baseSheets;
      // 有月份筛选时，如果一个文件没有对应月页签，不要回退读“历史总表/全部页签”。
      // 之前会读 A:ZZ60000 的历史页签，导致 Netlify 函数 502/崩溃。
      let targetSheets = monthKeys.length ? monthFilteredSheets : baseSheets;
      if (monthKeys.length && !targetSheets.length) {
        sourceInfo.push(`三方量表${fileIndex + 1} 跳过：没有 ${monthKeys.join(",")} 对应月页签`);
        continue;
      }
      if (monthKeys.length) {
        targetSheets = targetSheets.filter((name) => !isLikelyHugeHistoryVolumeSheet(name));
      }

      const sheetModulo = Math.max(1, Math.floor(Number(options.sheetModulo || 1) || 1));
      const sheetRemainder = Math.max(0, Math.floor(Number(options.sheetRemainder || 0) || 0)) % sheetModulo;
      if (sheetModulo > 1 && targetSheets.length > 1) {
        targetSheets = targetSheets.filter((_, index) => index % sheetModulo === sheetRemainder);
      }
      sourceInfo.push(`三方量表${fileIndex + 1} ${targetSheets.length}/${baseSheets.length}个页签${monthKeys.length ? `（月份 ${monthKeys.join(",")}）` : ""}${configuredSheets.length && !configuredMonthSheets.length && monthKeys.length ? "，配置页签无此月份，已自动改读检测到的历史月页签" : ""}${sheetModulo > 1 ? `，页签分片 ${sheetRemainder + 1}/${sheetModulo}` : ""}`);

      for (const sheetName of targetSheets) {
        const sheetRanges = thirdPartyVolumeRangesForSheet(sheetName, readRange, rangeLimit, gridMetaBySheet[sheetName], options.columnModulo || 1, options.columnRemainder || 0);
        for (const rangeChunk of chunkArray(sheetRanges, 4)) {
          try {
            const ranges = rangeChunk.map((range) => sheetRange(sheetName, range));
            const response: any = await withGoogleRetry(
              () => sheets.spreadsheets.values.batchGet({ spreadsheetId, ranges }),
              `分块读取三方量 ${spreadsheetId} ${sheetName} ${rangeChunk.join(",")}`
            );
            const valueRanges = response.data.valueRanges || [];
            rangeChunk.forEach((range, index) => {
              const values = (valueRanges[index]?.values || []) as string[][];
              if (!values.length) return;
              const baseKey = spreadsheetIds.length > 1 ? `[三方量表${fileIndex + 1}] ${sheetName}` : sheetName;
              // 每个横向分区作为一个独立小表传给解析器。
              result[`${baseKey} ${range}`] = values;
            });
          } catch (error) {
            failedSheets.push(`${spreadsheetId}/${sheetName}/${rangeChunk.join(",")}: ${errorMessage(error)}`);
          }
        }
      }
    } catch (error) {
      failedSheets.push(`${spreadsheetId}: ${errorMessage(error)}`);
    }
  }

  const payload = buildThirdPartyVolumePayload(result);

  // V220：所有实际读取都失败时必须抛错，不能把“0 行 + failedSheets”当成一次正常分片。
  // 这样定时游标不会跳过失败分片，手动按钮也会直接显示真实错误，而不是假装刷新完成。
  if (!payload.rows.length && failedSheets.length) {
    throw new Error(`三方量本次分片全部读取失败：${failedSheets.slice(0, 6).join("；")}`);
  }

  const messages: string[] = [];
  messages.push(`三方量读取：${sourceInfo.join("；") || `${spreadsheetIds.length} 个表`}，范围 ${readRange}；V222 metadata 真实行列读取；当前月分片合并，历史月自动读取4/5/6等历史页签；失败保留旧快照`);
  if (failedSheets.length) {
    messages.push(`部分页签失败 ${failedSheets.length} 个，已保留可读取的数据`);
    (payload.meta as any).failedSheets = failedSheets.slice(0, 20);
  }
  payload.meta.message = [payload.meta.message, ...messages].filter(Boolean).join("；");
  (payload.meta as any).monthKeys = monthKeys;
  (payload.meta as any).sourceIndexes = spreadsheetSources.map((x) => x.sourceIndex);
  (payload.meta as any).sheetModulo = options.sheetModulo || 1;
  (payload.meta as any).sheetRemainder = options.sheetRemainder || 0;
  (payload.meta as any).columnModulo = options.columnModulo || 1;
  (payload.meta as any).columnRemainder = options.columnRemainder || 0;
  return payload;
}


function getConfiguredWorkOrderSpreadsheetIds(): string[] {
  const configIds = Array.from(
    new Set(
      (WORK_ORDER_SOURCE_CONFIG.sheetIds || [])
        .map(spreadsheetIdFromInput)
        .filter(Boolean)
    )
  );
  const envIds = spreadsheetIdsFromEnv("WORK_ORDER_SHEET_IDS", ["WORK_ORDER_SHEET_ID", "WORK_ORDER_SPREADSHEET_ID"]);
  if (WORK_ORDER_SOURCE_CONFIG.useConfigFile) return configIds.length ? configIds : envIds;
  // V216：优先用 Netlify 环境变量；如果没填，才回退代码里的两个默认工单表。
  return envIds.length ? envIds : configIds;
}

function getConfiguredWorkOrderSheetNames(allSheetNames: string[]): string[] {
  const fixedSheets = (WORK_ORDER_SOURCE_CONFIG.sheetNames || [])
    .map((name) => String(name || "").replace(/[​-‍﻿]/g, "").trim())
    .filter(Boolean);
  if (fixedSheets.length) return fixedSheets;

  // V226：不再使用旧 WORK_ORDER_SHEETS 白名单。旧名单很容易仍指向已删除页签，
  // 导致真实表明明有 raw_workorder_*，后台却一个也读不到。
  // 工单默认只读标准 RAW 页签，让代码自己统计，避免把展示表/备份表读进去重复计算。
  const prefixes = (WORK_ORDER_SOURCE_CONFIG.sheetNamePrefixes || [])
    .map((prefix) => String(prefix || "").toLowerCase().trim())
    .filter(Boolean);
  if (prefixes.length) {
    const matched = allSheetNames.filter((name) => {
      const lower = String(name || "").toLowerCase().trim();
      return prefixes.some((prefix) => lower.startsWith(prefix));
    });
    if (matched.length) return matched;
  }

  return allSheetNames;
}

function filterWorkOrderPayloadToMonths(payload: WorkOrderPayload, monthKeys: string[]): WorkOrderPayload {
  if (!monthKeys.length) return payload;
  const prefixes = new Set(monthKeys.map((month) => month.replace("_", "-")));
  const rows = (payload.rows || []).filter((row) => prefixes.has(String(row.date || "").slice(0, 7)));
  const uniqCount = (values: string[]) => new Set(values.filter(Boolean)).size;
  const dates = rows.map((row) => row.date).filter((date) => /^20\d{2}-\d{2}-\d{2}$/.test(date)).sort();
  const latest = dates[dates.length - 1] || "";
  return {
    ...payload,
    meta: {
      ...payload.meta,
      year: latest ? latest.slice(0, 4) : monthKeys[0].slice(0, 4),
      month: latest ? String(Number(latest.slice(5, 7))) : String(Number(monthKeys[0].slice(5, 7)))
    },
    rows,
    summary: {
      total: rows.reduce((sum, row) => sum + row.total, 0),
      success: rows.reduce((sum, row) => sum + row.success, 0),
      failed: rows.reduce((sum, row) => sum + row.failed, 0),
      pending: rows.reduce((sum, row) => sum + row.pending, 0),
      amount: rows.reduce((sum, row) => sum + row.amount, 0),
      countries: uniqCount(rows.map((row) => row.country)),
      platforms: uniqCount(rows.map((row) => row.platform)),
      types: uniqCount(rows.map((row) => row.workType)),
      names: uniqCount(rows.map((row) => row.workName)),
      operators: uniqCount(rows.map((row) => row.operator))
    },
    // 如果是从无月份后缀的通用 RAW 页签读取，旧 anomalies 可能包含其它月份，宁可重新留空也不显示错误月份。
    anomalies: []
  };
}

export async function getWorkOrderPayload(options: MonthlySheetReadOptions = {}): Promise<WorkOrderPayload> {
  const clientEmail = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY"));
  const spreadsheetIds = getConfiguredWorkOrderSpreadsheetIds();

  if (!spreadsheetIds.length) {
    throw new Error(
      WORK_ORDER_SOURCE_CONFIG.useConfigFile
        ? "WORK_ORDER_SOURCE_CONFIG.sheetIds 没有配置工单表 ID"
        : "Missing environment variable: WORK_ORDER_SHEET_ID or WORK_ORDER_SHEET_IDS"
    );
  }

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  const result: Record<string, string[][]> = {};
  const failedSheets: string[] = [];
  const sourceInfo: string[] = [];
  const monthKeys = options.forceAll ? [] : (options.months || []).map(toYyyyMm).filter(Boolean);
  let usedAllRawFallback = false;

  // V208：工单页签也改为顺序分批读取，避免 Promise.all 一次打太多 Google 请求，
  // 导致定时同步偶发失败，然后前台只能看到旧快照。
  for (const [fileIndex, spreadsheetId] of spreadsheetIds.entries()) {
    try {
      const metadata = await withGoogleRetry(
        () => sheets.spreadsheets.get({ spreadsheetId, includeGridData: false }),
        `读取工单页签列表 ${spreadsheetId}`
      );
      const allSheetNames = sheetTitlesFromMetadata(metadata);
      const gridMetaBySheet = sheetGridMetaMap(metadata);
      const configuredTargetSheets = getConfiguredWorkOrderSheetNames(allSheetNames);
      const monthMatchedSheets = monthKeys.length
        ? configuredTargetSheets.filter((name) => sheetNameMatchesMonthKeys(name, monthKeys))
        : configuredTargetSheets;
      // 有些真实工单 RAW 页签没有月份后缀。旧版强制按页签名筛月份会得到 0 个页签。
      // 找不到月份页签时，回退读取全部 raw_workorder_*，解析后再按行日期过滤到目标月份。
      const targetSheets = monthKeys.length && !monthMatchedSheets.length ? configuredTargetSheets : monthMatchedSheets;
      if (monthKeys.length && !monthMatchedSheets.length && configuredTargetSheets.length) usedAllRawFallback = true;
      sourceInfo.push(`工单表${fileIndex + 1} ${targetSheets.length}个页签${monthKeys.length ? `（月份 ${monthKeys.join(",")}${!monthMatchedSheets.length ? "，使用通用RAW回退" : ""}）` : ""}`);

      for (const chunk of chunkArray(targetSheets, 8)) {
        await Promise.all(chunk.map(async (name) => {
          try {
            const grid = gridMetaBySheet[name];
            const defaultRows = Math.max(1, Math.min(60000, Number(grid?.rowCount || 0) || 60000));
            const defaultCols = Math.max(1, Math.min(512, Number(grid?.columnCount || 0) || 120));
            const safeDefaultRange = `A1:${columnName(defaultCols - 1)}${defaultRows}`;
            const response: any = await withGoogleRetry(
              () => sheets.spreadsheets.values.get({
                spreadsheetId,
                range: sheetRange(name, WORK_ORDER_SOURCE_CONFIG.range || safeDefaultRange)
              }),
              `读取工单 ${spreadsheetId}/${name}`
            );
            const key = spreadsheetIds.length > 1 ? `[工单表${fileIndex + 1}] ${name}` : name;
            result[key] = (response.data.values || []) as string[][];
          } catch (error) {
            failedSheets.push(`${spreadsheetId}/${name}: ${errorMessage(error)}`);
          }
        }));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      failedSheets.push(`${spreadsheetId}: ${message}`);
    }
  }

  if (!Object.keys(result).length) {
    throw new Error(`工单没有读取到任何页签：已检查 ${spreadsheetIds.length} 个工单表；${failedSheets.slice(0, 6).join("；") || "未找到 raw_workorder_* 页签，请确认实际工单表已分享给 Service Account"}`);
  }

  let payload = buildWorkOrderPayload(result);
  if (monthKeys.length && usedAllRawFallback) payload = filterWorkOrderPayloadToMonths(payload, monthKeys);
  if (!payload.rows.length) {
    throw new Error(`工单已读取 ${Object.keys(result).length} 个页签，但目标月份 ${monthKeys.join(",") || "全部"} 解析结果为 0 行。实际页签：${Object.keys(result).slice(0, 12).join("、")}。请确认 RAW 表头和 stat_date/date 日期列。`);
  }
  const messages: string[] = [];
  messages.push(
    WORK_ORDER_SOURCE_CONFIG.useConfigFile
      ? `V226 工单读取：使用代码备用来源 ${spreadsheetIds.length} 个表（${sourceInfo.join("，")}），自动识别 raw_workorder_* 页签。`
      : `V226 工单读取：优先使用 Netlify WORK_ORDER_SHEET_ID / WORK_ORDER_SHEET_IDS 的 ${spreadsheetIds.length} 个表（${sourceInfo.join("，")}），自动识别全部 raw_workorder_* 页签。`
  );
  if (usedAllRawFallback) messages.push(`目标月份页签名未命中，已读取全部 raw_workorder_* 后按数据日期筛选 ${monthKeys.join(",")}。`);
  if (failedSheets.length) {
    messages.push(`部分工单表读取失败：${failedSheets.slice(0, 5).join("；")}${failedSheets.length > 5 ? "..." : ""}。请检查ID大小写/权限，确认工单表已分享给 Service Account。`);
  }
  (payload.meta as any).sourceSpreadsheetIds = spreadsheetIds;
  (payload.meta as any).sourceInfo = sourceInfo;
  (payload.meta as any).failedSheets = failedSheets.slice(0, 20);
  if (messages.length) payload.meta.message = messages.join("；");
  return payload;
}


export async function getCustomerServicePayload(options: MonthlySheetReadOptions = {}): Promise<CustomerServicePayload> {
  const spreadsheetId = process.env.CUSTOMER_SERVICE_SHEET_ID || DEFAULT_CUSTOMER_SERVICE_SHEET_ID;
  const clientEmail = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY"));

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"]
  });

  const sheets = google.sheets({ version: "v4", auth });
  const metadata = await sheets.spreadsheets.get({ spreadsheetId, includeGridData: false });
  const allSheetNames = sheetTitlesFromMetadata(metadata);

  const configuredSheets = listFromEnv("CUSTOMER_SERVICE_SHEETS", []);
  const allTargets = configuredSheets.length ? configuredSheets : allSheetNames;
  const monthKeys = options.forceAll ? [] : (options.months || []).map(toYyyyMm).filter(Boolean);
  const targetSheets = monthKeys.length
    ? allTargets.filter((name) => sheetNameMatchesMonthKeys(name, monthKeys))
    : allTargets;
  const result: Record<string, string[][]> = {};

  await Promise.all(
    targetSheets.map(async (name) => {
      try {
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: sheetRange(name, "A1:ZZ20000")
        });
        result[name] = (response.data.values || []) as string[][];
      } catch {
        result[name] = [];
      }
    })
  );

  return buildCustomerServicePayload(result);
}
